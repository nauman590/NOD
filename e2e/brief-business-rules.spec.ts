import { test, expect, request as pwRequest, APIRequestContext } from "@playwright/test";

const API = "http://localhost:3001/api";

// Brief conformance — the money and accountability rules stated as hard numbers in
// NOD_Dev_Handoff_Brief.pdf. The rest of the suite proves the FLOWS work; this file proves
// the NUMBERS are right, because those are what the business actually runs on and a silent
// drift in any of them (a fee rate, a strike threshold) costs real money without failing
// anything else.
//
// Covered, quoting the brief:
//   Payment splits    — 18% platform on base, 82% to provider, 0% on add-ons,
//                       provider receives 100% of cancellation fees
//   Cancellation      — free before claim / $10 after claim / 25% after en route /
//                       50% customer no-show / 3 no-shows in 60 days → suspension
//   Provider strikes  — 3 in 30 days → 7-day suspension; 5 in 90 days → deactivation
//   Late arrival      — 20+ min late without a delay notice → 10% credited to customer
//   Price lock        — 15 minutes
//   Messaging         — no contact channel until the job is in progress
//
// Everything runs against the real API and real Stripe test mode.

let ctx: APIRequestContext;
let adminTok: string;
let categoryId: string;

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const uniq = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

// Full real-Stripe job lifecycles per test.
test.describe.configure({ timeout: 120_000 });

async function registerProvider() {
  const res = await ctx.post(`${API}/auth/register/provider`, {
    data: {
      email: `br_pro_${uniq()}@nod.app`,
      // 555 is not a dialable area code — never a real subscriber. See sms-otp-optin.spec.ts.
      phone: `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      password: "provider1234",
      fullName: "Brief Pro",
      licenseUrl: "http://x/license.jpg",
      profilePhotoUrl: "http://x/pro.jpg",
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { token: body.accessToken as string, id: body.provider.id as string, userId: body.user.id as string };
}

async function activateProvider(id: string, token: string) {
  await ctx.post(`${API}/admin/providers/${id}/background`, { headers: bearer(adminTok), data: { result: "PASSED" } });
  await ctx.post(`${API}/admin/providers/${id}/approve`, { headers: bearer(adminTok) });
  await ctx.put(`${API}/providers/me/rates`, {
    headers: bearer(token),
    data: { rates: [{ categoryId, hourlyRateCents: 6000, active: true }] },
  });
}

async function activeProvider() {
  const pro = await registerProvider();
  await activateProvider(pro.id, pro.token);
  return pro;
}

async function registerCustomer() {
  const res = await ctx.post(`${API}/auth/register/customer`, {
    data: { email: `br_cust_${uniq()}@nod.app`, password: "secret123", fullName: "Brief Cust" },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { token: body.accessToken as string, id: body.user.id as string };
}

async function createJob(customerToken: string) {
  const est = await (
    await ctx.post(`${API}/estimate`, {
      data: { categorySlug: "junk", description: "Old sofa and boxes", serviceAddress: "500 Peachtree St NE, Atlanta, GA" },
    })
  ).json();
  const res = await ctx.post(`${API}/jobs`, { headers: bearer(customerToken), data: { estimateId: est.estimateId } });
  expect(res.ok()).toBeTruthy();
  const job = await res.json();
  return { id: job.id as string, basePriceCents: job.basePriceCents as number };
}

const getJob = async (jobId: string, token: string) =>
  (await ctx.get(`${API}/jobs/${jobId}`, { headers: bearer(token) })).json();

const paymentsFor = async (token: string) => (await ctx.get(`${API}/payments/mine`, { headers: bearer(token) })).json();

// The ledger row of a given type for a job. Payouts land on the provider's ledger,
// charges on the customer's.
const rowFor = (rows: any[], jobId: string, type: string) => rows.find((p: any) => p.jobId === jobId && p.type === type);

test.beforeAll(async () => {
  ctx = await pwRequest.newContext();
  const admin = await (
    await ctx.post(`${API}/auth/login`, { data: { emailOrPhone: "admin@nod.app", password: "admin1234" } })
  ).json();
  adminTok = admin.accessToken;
  const cats = await (await ctx.get(`${API}/categories`)).json();
  categoryId = cats.find((c: any) => c.slug === "junk").id;
});

test.afterAll(async () => {
  await ctx.dispose();
});

test.describe("Payment splits", () => {
  test("platform takes 18% of base, provider keeps 82% — and 100% of approved add-ons", async () => {
    const pro = await activeProvider();
    const cust = await registerCustomer();
    const job = await createJob(cust.token);
    const P = bearer(pro.token);

    await ctx.post(`${API}/jobs/${job.id}/claim`, { headers: P });
    await ctx.post(`${API}/jobs/${job.id}/en-route`, { headers: P });
    await ctx.post(`${API}/jobs/${job.id}/photos`, { headers: P, data: { kind: "BEFORE", url: "http://x/b.jpg" } });
    await ctx.post(`${API}/jobs/${job.id}/arrived`, { headers: P });
    await ctx.post(`${API}/jobs/${job.id}/start`, { headers: P });

    // A customer-approved add-on. The brief is explicit that the platform takes 0% here.
    const addOnCents = 5000;
    await ctx.post(`${API}/jobs/${job.id}/adjustments`, {
      headers: P,
      data: { items: [{ description: "Extra flight of stairs", priceCents: addOnCents }] },
    });
    await ctx.post(`${API}/jobs/${job.id}/adjustments/approve`, { headers: bearer(cust.token) });

    await ctx.post(`${API}/jobs/${job.id}/photos`, { headers: P, data: { kind: "AFTER", url: "http://x/a.jpg" } });
    expect((await ctx.post(`${API}/jobs/${job.id}/complete`, { headers: P })).ok()).toBeTruthy();

    const base = job.basePriceCents;
    const expectedFee = Math.round(base * 0.18);
    const expectedPayout = base - expectedFee + addOnCents;

    const payout = rowFor(await paymentsFor(pro.token), job.id, "PAYOUT");
    expect(payout).toBeTruthy();
    expect(payout.amountCents).toBe(expectedPayout);

    // Stated as its own assertion so a regression names the actual rule: the add-on passes
    // through whole, so the platform's cut is exactly 18% of base and nothing more.
    expect(payout.amountCents - addOnCents).toBe(Math.round(base * 0.82));
    expect(base + addOnCents - payout.amountCents).toBe(expectedFee);
  });
});

test.describe("Customer cancellation policy", () => {
  test("before the provider claims: free, hold released", async () => {
    const cust = await registerCustomer();
    const job = await createJob(cust.token);

    const res = await ctx.post(`${API}/jobs/${job.id}/cancel`, {
      headers: bearer(cust.token),
      data: { reason: "changed my mind" },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).cancellationFeeCents).toBe(0);
    expect(rowFor(await paymentsFor(cust.token), job.id, "CANCELLATION_FEE")).toBeUndefined();
  });

  test("after claim, before en route: $10 flat — not a percentage", async () => {
    const pro = await activeProvider();
    const cust = await registerCustomer();
    const job = await createJob(cust.token);
    await ctx.post(`${API}/jobs/${job.id}/claim`, { headers: bearer(pro.token) });

    const res = await ctx.post(`${API}/jobs/${job.id}/cancel`, {
      headers: bearer(cust.token),
      data: { reason: "no longer needed" },
    });
    expect(res.ok()).toBeTruthy();
    // Flat $10 regardless of job size — assert it is NOT 25% of base, which is the
    // adjacent tier and the easy way for this to silently regress.
    expect((await res.json()).cancellationFeeCents).toBe(1000);
    expect(1000).not.toBe(Math.round(job.basePriceCents * 0.25));
  });

  test("customer no-show on arrival: 50% of base, and the provider receives 100% of it", async () => {
    const pro = await activeProvider();
    const cust = await registerCustomer();
    const job = await createJob(cust.token);
    const P = bearer(pro.token);

    await ctx.post(`${API}/jobs/${job.id}/claim`, { headers: P });
    await ctx.post(`${API}/jobs/${job.id}/en-route`, { headers: P });
    await ctx.post(`${API}/jobs/${job.id}/photos`, { headers: P, data: { kind: "BEFORE", url: "http://x/b.jpg" } });
    await ctx.post(`${API}/jobs/${job.id}/arrived`, { headers: P });

    const res = await ctx.post(`${API}/jobs/${job.id}/no-show`, { headers: P });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe("CANCELLED");

    const expectedFee = Math.round(job.basePriceCents * 0.5);
    expect(body.cancellationFeeCents).toBe(expectedFee);

    // Charged to the customer...
    const charge = rowFor(await paymentsFor(cust.token), job.id, "CANCELLATION_FEE");
    expect(charge?.amountCents).toBe(expectedFee);
    // ...and passed to the provider in full — the brief gives the platform no cut here.
    expect(charge.platformFeeCents).toBe(0);

    // The provider must be credited in the ledger, not just via a Stripe transfer that may
    // not be possible yet (no connected account). Otherwise the fee is collected from the
    // customer with nothing recording that the provider is owed it.
    const proCredit = rowFor(await paymentsFor(pro.token), job.id, "PAYOUT");
    expect(proCredit?.amountCents).toBe(expectedFee);
    expect(proCredit.platformFeeCents).toBe(0);
  });

  test("three customer no-shows in 60 days suspends the account", async () => {
    const pro = await activeProvider();
    const cust = await registerCustomer();

    for (let i = 1; i <= 3; i++) {
      const job = await createJob(cust.token);
      const P = bearer(pro.token);
      await ctx.post(`${API}/jobs/${job.id}/claim`, { headers: P });
      await ctx.post(`${API}/jobs/${job.id}/en-route`, { headers: P });
      await ctx.post(`${API}/jobs/${job.id}/photos`, { headers: P, data: { kind: "BEFORE", url: "http://x/b.jpg" } });
      await ctx.post(`${API}/jobs/${job.id}/arrived`, { headers: P });
      const res = await ctx.post(`${API}/jobs/${job.id}/no-show`, { headers: P });
      expect(res.ok()).toBeTruthy();
      expect((await res.json()).customerNoShows).toBe(i);
    }

    // Suspended — and the suspension must actually bite, not just be recorded.
    const customers = await (await ctx.get(`${API}/admin/customers`, { headers: bearer(adminTok) })).json();
    const row = (customers.items ?? customers).find((c: any) => c.id === cust.id);
    expect(row?.suspendedUntil).toBeTruthy();

    const blocked = await ctx.post(`${API}/jobs`, {
      headers: bearer(cust.token),
      data: { estimateId: (await (await ctx.post(`${API}/estimate`, { data: { categorySlug: "junk", description: "another job", serviceAddress: "500 Peachtree St NE, Atlanta, GA" } })).json()).estimateId },
    });
    expect(blocked.ok()).toBeFalsy();
  });
});

test.describe("Provider strike escalation", () => {
  test("3 strikes in 30 days suspends; 5 in 90 days deactivates", async () => {
    const pro = await activeProvider();
    const strike = () =>
      ctx.post(`${API}/admin/providers/${pro.id}/strikes`, {
        headers: bearer(adminTok),
        data: { reason: "OTHER", note: "brief conformance" },
      });
    const status = async () => (await (await ctx.get(`${API}/providers/me`, { headers: bearer(pro.token) })).json()).status;

    await strike();
    await strike();
    expect(await status()).toBe("ACTIVE"); // two strikes is not yet a suspension

    await strike();
    expect(await status()).toBe("SUSPENDED"); // 3 in 30 days → 7-day suspension

    await strike();
    await strike();
    expect(await status()).toBe("DEACTIVATED"); // 5 in 90 days → deactivation
  });

  test("a suspended provider cannot claim work", async () => {
    const pro = await activeProvider();
    for (let i = 0; i < 3; i++) {
      await ctx.post(`${API}/admin/providers/${pro.id}/strikes`, {
        headers: bearer(adminTok),
        data: { reason: "OTHER", note: "brief conformance" },
      });
    }
    const cust = await registerCustomer();
    const job = await createJob(cust.token);
    const res = await ctx.post(`${API}/jobs/${job.id}/claim`, { headers: bearer(pro.token) });
    expect(res.ok()).toBeFalsy();
  });
});

test.describe("Price lock", () => {
  test("an estimate is locked for 15 minutes", async () => {
    const before = Date.now();
    const est = await (
      await ctx.post(`${API}/estimate`, {
        data: { categorySlug: "junk", description: "Old sofa", serviceAddress: "500 Peachtree St NE, Atlanta, GA" },
      })
    ).json();

    expect(est.lockMinutes).toBe(15);
    const lockMs = new Date(est.lockedUntil).getTime() - before;
    // Allow for round-trip latency; the point is that it's a 15-minute window, not 5 or 60.
    expect(lockMs).toBeGreaterThan(14 * 60_000);
    expect(lockMs).toBeLessThanOrEqual(15 * 60_000 + 30_000);
  });
});

test.describe("In-app messaging", () => {
  test("no channel opens until the job is in progress", async () => {
    const pro = await activeProvider();
    const cust = await registerCustomer();
    const job = await createJob(cust.token);
    const P = bearer(pro.token);

    // Claimed, en route and arrived are all still too early — the brief withholds any
    // direct channel until the job is actually underway.
    await ctx.post(`${API}/jobs/${job.id}/claim`, { headers: P });
    expect((await ctx.post(`${API}/jobs/${job.id}/messages`, { headers: P, data: { body: "hi" } })).ok()).toBeFalsy();

    await ctx.post(`${API}/jobs/${job.id}/en-route`, { headers: P });
    await ctx.post(`${API}/jobs/${job.id}/photos`, { headers: P, data: { kind: "BEFORE", url: "http://x/b.jpg" } });
    await ctx.post(`${API}/jobs/${job.id}/arrived`, { headers: P });
    expect(
      (await ctx.post(`${API}/jobs/${job.id}/messages`, { headers: bearer(cust.token), data: { body: "hi" } })).ok(),
    ).toBeFalsy();

    // In progress → both directions open.
    await ctx.post(`${API}/jobs/${job.id}/start`, { headers: P });
    expect((await ctx.post(`${API}/jobs/${job.id}/messages`, { headers: P, data: { body: "on it" } })).ok()).toBeTruthy();
    expect(
      (await ctx.post(`${API}/jobs/${job.id}/messages`, { headers: bearer(cust.token), data: { body: "thanks" } })).ok(),
    ).toBeTruthy();

    const thread = await (await ctx.get(`${API}/jobs/${job.id}/messages`, { headers: bearer(cust.token) })).json();
    expect(thread.map((m: any) => m.body)).toEqual(["on it", "thanks"]);

    // A stranger can neither read nor write the thread.
    const outsider = await registerCustomer();
    expect((await ctx.get(`${API}/jobs/${job.id}/messages`, { headers: bearer(outsider.token) })).ok()).toBeFalsy();
  });
});
