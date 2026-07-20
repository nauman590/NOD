import { test, expect, request as pwRequest, APIRequestContext } from "@playwright/test";

const API = "http://localhost:3001/api";

// Sprint 4 — Accountability & Polish. Drives the REAL API end-to-end:
//   1. customer rating surfaced on the available-job card
//   2. two-way ratings + provider completed-job view
//   3. provider claim-and-no-show ($15–25 + strike)
//   4. off-platform report → admin verify → immediate ban
//   6. before/after photo hard gate on arrive/complete
// (5, profile photo, is covered by both this file and the UI spec.)

let ctx: APIRequestContext;
let adminTok: string;
let categoryId: string;
let proTok: string;
let proId: string;
let custTok: string;
let custId: string;

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const uniq = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

// Full real-Stripe job lifecycles per test — allow more than the default 30s under load.
test.describe.configure({ timeout: 120_000 });

async function registerProvider() {
  const email = `s4_pro_${uniq()}@nod.app`;
  const res = await ctx.post(`${API}/auth/register/provider`, {
    data: { email, phone: `+1555${Date.now() % 10000000}`, password: "provider1234", fullName: "S4 Pro", licenseUrl: "http://x/license.jpg", profilePhotoUrl: "http://x/pro.jpg" },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { token: body.accessToken as string, id: body.provider.id as string };
}

async function activateProvider(id: string, token: string) {
  await ctx.post(`${API}/admin/providers/${id}/background`, { headers: bearer(adminTok), data: { result: "PASSED" } });
  await ctx.post(`${API}/admin/providers/${id}/approve`, { headers: bearer(adminTok) });
  await ctx.put(`${API}/providers/me/rates`, { headers: bearer(token), data: { rates: [{ categoryId, hourlyRateCents: 6000, active: true }] } });
  const me = await (await ctx.get(`${API}/providers/me`, { headers: bearer(token) })).json();
  expect(me.status).toBe("ACTIVE");
}

async function registerCustomer() {
  const email = `s4_cust_${uniq()}@nod.app`;
  const res = await ctx.post(`${API}/auth/register/customer`, { data: { email, password: "secret123", fullName: "S4 Cust" } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { token: body.accessToken as string, id: body.user.id as string, email };
}

async function createJob(customerToken: string) {
  const est = await (
    await ctx.post(`${API}/estimate`, {
      data: { categorySlug: "junk", description: "Old sofa and boxes", serviceAddress: "500 Peachtree St NE, Atlanta, GA" },
    })
  ).json();
  const res = await ctx.post(`${API}/jobs`, { headers: bearer(customerToken), data: { estimateId: est.estimateId } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id as string;
}

test.beforeAll(async () => {
  ctx = await pwRequest.newContext();
  const admin = await (await ctx.post(`${API}/auth/login`, { data: { emailOrPhone: "admin@nod.app", password: "admin1234" } })).json();
  adminTok = admin.accessToken;
  const cats = await (await ctx.get(`${API}/categories`)).json();
  categoryId = cats.find((c: any) => c.slug === "junk").id;
  const pro = await registerProvider();
  proTok = pro.token;
  proId = pro.id;
  await activateProvider(proId, proTok);
  const cust = await registerCustomer();
  custTok = cust.token;
  custId = cust.id;
});

test.afterAll(async () => {
  await ctx.dispose();
});

test.describe.serial("Sprint 4 accountability", () => {
  let job1: string;

  test("item 6: before/after photos hard-gate arrival and completion", async () => {
    job1 = await createJob(custTok);
    await ctx.post(`${API}/jobs/${job1}/claim`, { headers: bearer(proTok) });
    await ctx.post(`${API}/jobs/${job1}/en-route`, { headers: bearer(proTok) });

    // Arrive is blocked without a BEFORE photo.
    const arrBlocked = await ctx.post(`${API}/jobs/${job1}/arrived`, { headers: bearer(proTok) });
    expect(arrBlocked.status()).toBe(400);
    expect(String((await arrBlocked.json()).message)).toMatch(/before/i);

    await ctx.post(`${API}/jobs/${job1}/photos`, { headers: bearer(proTok), data: { kind: "BEFORE", url: "http://x/b.jpg" } });
    const arrOk = await ctx.post(`${API}/jobs/${job1}/arrived`, { headers: bearer(proTok) });
    expect(arrOk.ok()).toBeTruthy();

    await ctx.post(`${API}/jobs/${job1}/start`, { headers: bearer(proTok) });

    // Complete is blocked without an AFTER photo.
    const cmpBlocked = await ctx.post(`${API}/jobs/${job1}/complete`, { headers: bearer(proTok) });
    expect(cmpBlocked.status()).toBe(400);
    expect(String((await cmpBlocked.json()).message)).toMatch(/after/i);

    await ctx.post(`${API}/jobs/${job1}/photos`, { headers: bearer(proTok), data: { kind: "AFTER", url: "http://x/a.jpg" } });
    const cmp = await ctx.post(`${API}/jobs/${job1}/complete`, { headers: bearer(proTok) });
    expect(cmp.ok()).toBeTruthy();
    expect((await cmp.json()).payoutCents).toBeGreaterThan(0);
  });

  test("item 2: two-way ratings + provider completed-job view", async () => {
    // Provider rates the customer; customer rates the provider.
    expect((await ctx.post(`${API}/jobs/${job1}/rate`, { headers: bearer(proTok), data: { stars: 5, comment: "great" } })).ok()).toBeTruthy();
    expect((await ctx.post(`${API}/jobs/${job1}/rate`, { headers: bearer(custTok), data: { stars: 4 } })).ok()).toBeTruthy();

    const completed = await (await ctx.get(`${API}/jobs/completed`, { headers: bearer(proTok) })).json();
    const row = completed.find((j: any) => j.id === job1);
    expect(row).toBeTruthy();
    expect(row.providerRatedCustomer).toBe(true);
    expect(row.providerGaveStars).toBe(5);
    expect(row.customerRatedProvider).toBe(true);
  });

  test("item 1: customer rating shows on the available-job card", async () => {
    const job2 = await createJob(custTok);
    const avail = await (await ctx.get(`${API}/jobs/available`, { headers: bearer(proTok) })).json();
    const card = avail.find((j: any) => j.id === job2);
    expect(card).toBeTruthy();
    // The customer earned one 5★ rating in the previous test.
    expect(card.customerRatingCount).toBe(1);
    expect(card.customerRatingAvg).toBe(5);
  });

  test("item 3: provider claim-and-no-show applies a $15–25 fee + NO_SHOW strike", async () => {
    const job3 = await createJob(custTok);
    await ctx.post(`${API}/jobs/${job3}/claim`, { headers: bearer(proTok) });

    const res = await ctx.post(`${API}/jobs/${job3}/provider-no-show`, { headers: bearer(custTok) });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe("CANCELLED");
    expect(body.noShowFeeCents).toBeGreaterThanOrEqual(1500);
    expect(body.noShowFeeCents).toBeLessThanOrEqual(2500);

    // The provider now carries a NO_SHOW strike.
    const providers = await (await ctx.get(`${API}/admin/providers?status=ACTIVE`, { headers: bearer(adminTok) })).json();
    const me = providers.find((p: any) => p.id === proId);
    expect(me.strikes.map((s: any) => s.reason)).toContain("NO_SHOW");
  });

  test("item 3: only the assigned customer can report a no-show, and only pre-arrival", async () => {
    const job = await createJob(custTok);
    // Not claimed yet → not eligible.
    const early = await ctx.post(`${API}/jobs/${job}/provider-no-show`, { headers: bearer(custTok) });
    expect(early.status()).toBe(400);

    // A different customer can't report someone else's job.
    const other = await registerCustomer();
    await ctx.post(`${API}/jobs/${job}/claim`, { headers: bearer(proTok) });
    const forbidden = await ctx.post(`${API}/jobs/${job}/provider-no-show`, { headers: bearer(other.token) });
    expect(forbidden.status()).toBe(403);
  });

  test("item 3: admin no-show sweep endpoint returns a detection summary", async () => {
    const res = await ctx.post(`${API}/admin/no-shows/sweep`, { headers: bearer(adminTok) });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.detected).toBe("number");
    expect(Array.isArray(body.jobIds)).toBe(true);
  });

  test("item 4: off-platform report → admin verify → immediate provider ban", async () => {
    // Fresh provider so the ban doesn't affect the shared one used by other tests.
    const victim = await registerProvider();
    await activateProvider(victim.id, victim.token);
    const job = await createJob(custTok);
    await ctx.post(`${API}/jobs/${job}/claim`, { headers: bearer(victim.token) });

    const rep = await (
      await ctx.post(`${API}/jobs/${job}/report-off-platform`, { headers: bearer(custTok), data: { description: "asked me to Venmo him" } })
    ).json();
    expect(rep.id).toBeTruthy();

    const queue = await (await ctx.get(`${API}/admin/off-platform-reports`, { headers: bearer(adminTok) })).json();
    expect(queue.some((r: any) => r.id === rep.id)).toBe(true);

    const verified = await (await ctx.post(`${API}/admin/off-platform-reports/${rep.id}/verify`, { headers: bearer(adminTok) })).json();
    expect(verified.ban.role).toBe("PROVIDER");
    expect(verified.status).toBe("VERIFIED");

    const me = await (await ctx.get(`${API}/providers/me`, { headers: bearer(victim.token) })).json();
    expect(me.status).toBe("DEACTIVATED");

    // A second verify on the same report is rejected.
    const again = await ctx.post(`${API}/admin/off-platform-reports/${rep.id}/verify`, { headers: bearer(adminTok) });
    expect(again.status()).toBe(400);
  });

  test("item 4: verifying a customer report bans the customer", async () => {
    const victim = await registerCustomer();
    const job = await createJob(victim.token);
    await ctx.post(`${API}/jobs/${job}/claim`, { headers: bearer(proTok) });

    // Provider reports the customer.
    const rep = await (
      await ctx.post(`${API}/jobs/${job}/report-off-platform`, { headers: bearer(proTok), data: { description: "offered cash to skip the app" } })
    ).json();
    const verified = await (await ctx.post(`${API}/admin/off-platform-reports/${rep.id}/verify`, { headers: bearer(adminTok) })).json();
    expect(verified.ban.role).toBe("CUSTOMER");

    // The banned customer can no longer log in.
    const login = await ctx.post(`${API}/auth/login`, { data: { emailOrPhone: victim.email, password: "secret123" } });
    expect(login.status()).toBe(403);
  });

  test("item 5: customer profile photo persists via auth profile", async () => {
    const res = await ctx.patch(`${API}/auth/profile`, { headers: bearer(custTok), data: { profilePhotoUrl: "http://x/avatar.jpg" } });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).user.profilePhotoUrl).toBe("http://x/avatar.jpg");
    const me = await (await ctx.get(`${API}/auth/me`, { headers: bearer(custTok) })).json();
    expect(me.user.profilePhotoUrl).toBe("http://x/avatar.jpg");
  });
});
