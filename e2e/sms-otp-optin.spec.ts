import { test, expect, request as pwRequest, APIRequestContext } from "@playwright/test";

const API = "http://localhost:3001/api";

// SMS / phone-verification / opt-in coverage. Drives the REAL API end-to-end and proves:
//   1. SMS opt-in defaults to ON at both signups and toggles via the account endpoint.
//   2. Phone OTP verification (/auth/phone/request-otp + /verify-otp): happy path, wrong
//      code, replay, and phone-clash.
//   3. All 5 "missing" SMS triggers fire (recorded as notification rows — SMS itself is a
//      graceful stub without Twilio keys, so the observable proof is the notification each
//      trigger emits): new-job-available, en-route, arrived, payout-deposited, cancel→provider.
//      Plus the two enhancements: claim carries the provider name, complete carries a receipt link.
//
// Jobs are routed through the `furniture` category (few active providers) so the fresh test
// provider is deterministically inside the NEW_JOB_AVAILABLE broadcast set (capped at 25).

let ctx: APIRequestContext;
let adminTok: string;
let furnitureCatId: string;
let proTok: string;
let proId: string;
let proName: string;

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const uniq = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const uniqPhone = () => `+1${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;

// Full real-Stripe job lifecycles per test — allow more than the default 30s under load.
test.describe.configure({ timeout: 120_000 });

async function registerProvider(smsOptIn?: boolean) {
  const email = `sms_pro_${uniq()}@nod.app`;
  const fullName = `SMS Pro ${uniq()}`;
  const res = await ctx.post(`${API}/auth/register/provider`, {
    data: { email, phone: uniqPhone(), password: "provider1234", fullName, vehicleType: "van", ...(smsOptIn !== undefined ? { smsOptIn } : {}) },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { token: body.accessToken as string, id: body.provider.id as string, user: body.user, fullName };
}

async function activateProvider(id: string, token: string) {
  await ctx.post(`${API}/admin/providers/${id}/background`, { headers: bearer(adminTok), data: { result: "PASSED" } });
  await ctx.post(`${API}/admin/providers/${id}/approve`, { headers: bearer(adminTok) });
  await ctx.put(`${API}/providers/me/rates`, { headers: bearer(token), data: { rates: [{ categoryId: furnitureCatId, hourlyRateCents: 6000, active: true }] } });
  const me = await (await ctx.get(`${API}/providers/me`, { headers: bearer(token) })).json();
  expect(me.status).toBe("ACTIVE");
}

async function registerCustomer(opts?: { phone?: string; smsOptIn?: boolean }) {
  const email = `sms_cust_${uniq()}@nod.app`;
  const data: any = { email, password: "secret123", fullName: "SMS Cust" };
  if (opts?.phone !== undefined) data.phone = opts.phone;
  if (opts?.smsOptIn !== undefined) data.smsOptIn = opts.smsOptIn;
  const res = await ctx.post(`${API}/auth/register/customer`, { data });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { token: body.accessToken as string, id: body.user.id as string, user: body.user, email };
}

async function createFurnitureJob(customerToken: string) {
  const est = await (
    await ctx.post(`${API}/estimate`, {
      data: { categorySlug: "furniture", description: "Assemble a bookshelf and a desk", serviceAddress: "500 Peachtree St NE, Atlanta, GA" },
    })
  ).json();
  const res = await ctx.post(`${API}/jobs`, { headers: bearer(customerToken), data: { estimateId: est.estimateId } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id as string;
}

// Poll a user's notification feed until one matching `match` shows up. notify() is awaited in
// most handlers, but the new-job broadcast is fire-and-forget, so polling keeps it race-free.
async function waitForNotification(token: string, match: (n: any) => boolean, timeout = 20_000) {
  let found: any = null;
  await expect
    .poll(
      async () => {
        const list = await (await ctx.get(`${API}/notifications`, { headers: bearer(token) })).json();
        found = Array.isArray(list) ? list.find(match) : null;
        return !!found;
      },
      { timeout, intervals: [400, 800, 1200, 2000] },
    )
    .toBe(true);
  return found;
}

test.beforeAll(async () => {
  ctx = await pwRequest.newContext();
  const admin = await (await ctx.post(`${API}/auth/login`, { data: { emailOrPhone: "admin@nod.app", password: "admin1234" } })).json();
  adminTok = admin.accessToken;
  const cats = await (await ctx.get(`${API}/categories`)).json();
  furnitureCatId = cats.find((c: any) => c.slug === "furniture").id;
  const pro = await registerProvider();
  proTok = pro.token;
  proId = pro.id;
  proName = pro.fullName;
  await activateProvider(proId, proTok);
});

test.afterAll(async () => {
  await ctx.dispose();
});

test.describe("SMS opt-in (default on + toggle)", () => {
  test("defaults to ON when omitted at customer signup", async () => {
    const cust = await registerCustomer(); // no smsOptIn passed
    expect(cust.user.smsOptIn).toBe(true);
    const me = await (await ctx.get(`${API}/auth/me`, { headers: bearer(cust.token) })).json();
    expect(me.user.smsOptIn).toBe(true);
  });

  test("respects an explicit opt-out at customer signup", async () => {
    const cust = await registerCustomer({ smsOptIn: false });
    expect(cust.user.smsOptIn).toBe(false);
  });

  test("defaults to ON when omitted at provider signup", async () => {
    const pro = await registerProvider(); // no smsOptIn passed
    expect(pro.user.smsOptIn).toBe(true);
  });

  test("account endpoint toggles the opt-in off and back on", async () => {
    const cust = await registerCustomer();
    const off = await ctx.patch(`${API}/auth/profile`, { headers: bearer(cust.token), data: { smsOptIn: false } });
    expect(off.ok()).toBeTruthy();
    expect((await off.json()).user.smsOptIn).toBe(false);

    const on = await ctx.patch(`${API}/auth/profile`, { headers: bearer(cust.token), data: { smsOptIn: true } });
    expect((await on.json()).user.smsOptIn).toBe(true);
  });
});

test.describe("Phone OTP verification", () => {
  test("request → wrong code rejected → correct code verifies → replay rejected", async () => {
    const phone = uniqPhone();
    const cust = await registerCustomer({ phone });
    expect(cust.user.phoneVerified).toBe(false);

    // Request an OTP. Twilio is stubbed in this environment, so the code is surfaced for testing.
    const req = await ctx.post(`${API}/auth/phone/request-otp`, { headers: bearer(cust.token), data: {} });
    expect(req.ok()).toBeTruthy();
    const { sent, devCode } = await req.json();
    expect(sent).toBe(false); // stubbed
    expect(devCode).toMatch(/^\d{6}$/);

    // A wrong code is rejected (400) and does NOT verify the phone.
    const wrong = devCode === "000000" ? "111111" : "000000";
    const bad = await ctx.post(`${API}/auth/phone/verify-otp`, { headers: bearer(cust.token), data: { code: wrong } });
    expect(bad.status()).toBe(400);

    // The correct code verifies.
    const good = await ctx.post(`${API}/auth/phone/verify-otp`, { headers: bearer(cust.token), data: { code: devCode } });
    expect(good.ok()).toBeTruthy();
    expect((await good.json()).phoneVerified).toBe(true);

    const me = await (await ctx.get(`${API}/auth/me`, { headers: bearer(cust.token) })).json();
    expect(me.user.phoneVerified).toBe(true);

    // Replaying the now-consumed code is rejected (no active code).
    const replay = await ctx.post(`${API}/auth/phone/verify-otp`, { headers: bearer(cust.token), data: { code: devCode } });
    expect(replay.status()).toBe(400);
  });

  test("requesting an OTP for a phone already in use is rejected (409)", async () => {
    const phone = uniqPhone();
    await registerCustomer({ phone }); // owns `phone`
    const other = await registerCustomer(); // no phone yet
    const clash = await ctx.post(`${API}/auth/phone/request-otp`, { headers: bearer(other.token), data: { phone } });
    expect(clash.status()).toBe(409);
  });

  test("verifying without an active code is rejected", async () => {
    const cust = await registerCustomer({ phone: uniqPhone() });
    const res = await ctx.post(`${API}/auth/phone/verify-otp`, { headers: bearer(cust.token), data: { code: "123456" } });
    expect(res.status()).toBe(400);
  });
});

test.describe.serial("SMS triggers fire as notifications across a job lifecycle", () => {
  test("new-job-available → claim → en-route → arrived → complete (payout + receipt)", async () => {
    const cust = await registerCustomer({ phone: uniqPhone() });
    const job = await createFurnitureJob(cust.token);

    // Trigger: new-job-available broadcast to the provider (fire-and-forget → poll).
    const newJob = await waitForNotification(proTok, (n) => n.template === "NEW_JOB_AVAILABLE" && n.jobId === job);
    expect(newJob.title).toMatch(/new job/i);

    // Claim → customer notified with the PROVIDER'S NAME (enhancement).
    expect((await ctx.post(`${API}/jobs/${job}/claim`, { headers: bearer(proTok) })).ok()).toBeTruthy();
    const claimed = await waitForNotification(cust.token, (n) => n.template === "JOB_CLAIMED" && n.jobId === job);
    expect(claimed.body).toContain(proName);
    expect((claimed.payload as any).providerName).toBe(proName);

    // Trigger: en-route → customer.
    expect((await ctx.post(`${API}/jobs/${job}/en-route`, { headers: bearer(proTok) })).ok()).toBeTruthy();
    await waitForNotification(cust.token, (n) => n.template === "PROVIDER_EN_ROUTE" && n.jobId === job);

    // Trigger: arrived → customer (requires a BEFORE photo per the hard gate).
    await ctx.post(`${API}/jobs/${job}/photos`, { headers: bearer(proTok), data: { kind: "BEFORE", url: "http://x/b.jpg" } });
    expect((await ctx.post(`${API}/jobs/${job}/arrived`, { headers: bearer(proTok) })).ok()).toBeTruthy();
    await waitForNotification(cust.token, (n) => n.template === "PROVIDER_ARRIVED" && n.jobId === job);

    // Complete → customer gets a RECEIPT LINK (enhancement); provider gets PAYOUT_DEPOSITED (trigger).
    await ctx.post(`${API}/jobs/${job}/start`, { headers: bearer(proTok) });
    await ctx.post(`${API}/jobs/${job}/photos`, { headers: bearer(proTok), data: { kind: "AFTER", url: "http://x/a.jpg" } });
    const cmp = await ctx.post(`${API}/jobs/${job}/complete`, { headers: bearer(proTok) });
    expect(cmp.ok()).toBeTruthy();

    const receipt = await waitForNotification(cust.token, (n) => n.template === "JOB_COMPLETE" && n.jobId === job);
    expect(receipt.body).toMatch(/receipt/i);
    expect((receipt.payload as any).receiptUrl).toContain(`/job/${job}`);

    const payout = await waitForNotification(proTok, (n) => n.template === "PAYOUT_DEPOSITED" && n.jobId === job);
    expect((payout.payload as any).payoutCents).toBeGreaterThan(0);
  });

  test("cancel → provider: an assigned provider is notified when the customer cancels", async () => {
    const cust = await registerCustomer({ phone: uniqPhone() });
    const job = await createFurnitureJob(cust.token);
    expect((await ctx.post(`${API}/jobs/${job}/claim`, { headers: bearer(proTok) })).ok()).toBeTruthy();

    const cancel = await ctx.post(`${API}/jobs/${job}/cancel`, { headers: bearer(cust.token) });
    expect(cancel.ok()).toBeTruthy();

    const note = await waitForNotification(proTok, (n) => n.template === "JOB_CANCELLED_PROVIDER" && n.jobId === job);
    expect(note.title).toMatch(/cancel/i);
  });
});
