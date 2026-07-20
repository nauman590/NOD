import { test, expect, request as pwRequest, APIRequestContext } from "@playwright/test";

const API = "http://localhost:3001/api";

// Regression: provider-initiated cancellation must NOT bill the customer.
//
// Cancellation fees are a *customer* policy. Historically jobs.service.cancel() called
// payments.handleCancellation() unconditionally, so when a PROVIDER abandoned a claimed
// (EN_ROUTE) job the customer was charged 25% and the cancelling provider received it —
// the provider could profit by walking away. The fix routes provider cancels through a
// full customer release (cancellationTier=null, no fee) and penalises the provider, exactly
// like markProviderNoShow. These tests drive the real API to prove both halves:
//   1. provider cancels EN_ROUTE  → fee $0, no customer charge row, provider gets a strike
//   2. customer cancels EN_ROUTE  → fee = 25%, a CANCELLATION_FEE row lands on the customer
// (2 is the contrast case: the fee machinery still works; only the *provider* path suppresses it.)

let ctx: APIRequestContext;
let adminTok: string;
let categoryId: string;

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const uniq = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

// Full real-Stripe job lifecycles per test — allow more than the default 30s under load.
test.describe.configure({ timeout: 120_000 });

async function registerProvider() {
  const email = `pcb_pro_${uniq()}@nod.app`;
  const res = await ctx.post(`${API}/auth/register/provider`, {
    data: { email, phone: `+1555${Date.now() % 10000000}`, password: "provider1234", fullName: "PCB Pro", licenseUrl: "http://x/license.jpg", profilePhotoUrl: "http://x/pro.jpg" },
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
  const email = `pcb_cust_${uniq()}@nod.app`;
  const res = await ctx.post(`${API}/auth/register/customer`, { data: { email, password: "secret123", fullName: "PCB Cust" } });
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

// Drive a fresh job to EN_ROUTE (the 25% AFTER_EN_ROUTE tier — the expensive case the bug
// exploited). Returns the job id.
async function jobEnRoute(custToken: string, proToken: string) {
  const job = await createJob(custToken);
  expect((await ctx.post(`${API}/jobs/${job}/claim`, { headers: bearer(proToken) })).ok()).toBeTruthy();
  expect((await ctx.post(`${API}/jobs/${job}/en-route`, { headers: bearer(proToken) })).ok()).toBeTruthy();
  return job;
}

test.beforeAll(async () => {
  ctx = await pwRequest.newContext();
  const admin = await (await ctx.post(`${API}/auth/login`, { data: { emailOrPhone: "admin@nod.app", password: "admin1234" } })).json();
  adminTok = admin.accessToken;
  const cats = await (await ctx.get(`${API}/categories`)).json();
  categoryId = cats.find((c: any) => c.slug === "junk").id;
});

test.afterAll(async () => {
  await ctx.dispose();
});

test("provider cancelling an EN_ROUTE job does NOT charge the customer, and strikes the provider", async () => {
  // Fresh pro so the LATE_CANCEL strike can't affect any shared/seeded provider.
  const pro = await registerProvider();
  await activateProvider(pro.id, pro.token);
  const cust = await registerCustomer();

  const job = await jobEnRoute(cust.token, pro.token);

  // The provider abandons the job.
  const cancel = await ctx.post(`${API}/jobs/${job}/cancel`, { headers: bearer(pro.token) });
  expect(cancel.ok()).toBeTruthy();
  const cancelBody = await cancel.json();
  expect(cancelBody.status).toBe("CANCELLED");

  // Core of the fix: no cancellation fee is charged on a provider-initiated cancel.
  expect(cancelBody.cancellationFeeCents).toBe(0);

  // The customer's ledger carries NO cancellation charge for this job (nothing captured,
  // and no FAILED row either — the fee was never even attempted).
  const custPayments = await (await ctx.get(`${API}/payments/mine`, { headers: bearer(cust.token) })).json();
  const cancelCharges = custPayments.filter((p: any) => p.jobId === job && p.type === "CANCELLATION_FEE");
  expect(cancelCharges).toHaveLength(0);

  // The provider carries the price instead: a LATE_CANCEL strike.
  const providers = await (await ctx.get(`${API}/admin/providers?status=ACTIVE`, { headers: bearer(adminTok) })).json();
  const me = providers.find((p: any) => p.id === pro.id);
  expect(me).toBeTruthy();
  expect(me.strikes.map((s: any) => s.reason)).toContain("LATE_CANCEL");

  // The customer is told their pro backed out (and that they weren't charged).
  const notes = await (await ctx.get(`${API}/notifications`, { headers: bearer(cust.token) })).json();
  const note = notes.find((n: any) => n.jobId === job && n.template === "JOB_CANCELLED_BY_PROVIDER");
  expect(note).toBeTruthy();
  expect(note.body).toMatch(/weren.?t charged/i);
});

test("customer cancelling an EN_ROUTE job still charges the 25% fee (contrast)", async () => {
  const pro = await registerProvider();
  await activateProvider(pro.id, pro.token);
  const cust = await registerCustomer();

  const job = await jobEnRoute(cust.token, pro.token);

  // What the base price is, so we can check the 25% math.
  const before = await (await ctx.get(`${API}/jobs/${job}`, { headers: bearer(cust.token) })).json();
  const expectedFee = Math.round(before.basePriceCents * 0.25);
  expect(expectedFee).toBeGreaterThan(0);

  // The customer cancels this time.
  const cancel = await ctx.post(`${API}/jobs/${job}/cancel`, { headers: bearer(cust.token) });
  expect(cancel.ok()).toBeTruthy();
  const cancelBody = await cancel.json();
  expect(cancelBody.status).toBe("CANCELLED");
  expect(cancelBody.cancellationFeeCents).toBe(expectedFee);

  // A captured CANCELLATION_FEE row lands on the customer's ledger for the exact amount.
  const custPayments = await (await ctx.get(`${API}/payments/mine`, { headers: bearer(cust.token) })).json();
  const fee = custPayments.find((p: any) => p.jobId === job && p.type === "CANCELLATION_FEE");
  expect(fee).toBeTruthy();
  expect(fee.amountCents).toBe(expectedFee);
  expect(fee.status).toBe("CAPTURED");
});

test("cancelling an APPROVED-addons job charges 25% of BASE only and refunds the add-ons", async () => {
  const pro = await registerProvider();
  await activateProvider(pro.id, pro.token);
  const cust = await registerCustomer();

  const job = await createJob(cust.token);
  const base = (await (await ctx.get(`${API}/jobs/${job}`, { headers: bearer(cust.token) })).json()).basePriceCents as number;

  // Drive to a post-arrival, in-progress state, then negotiate add-ons — this puts the job in
  // the APPROVED status, which used to fall through to the flat $10 AFTER_CLAIM tier.
  expect((await ctx.post(`${API}/jobs/${job}/claim`, { headers: bearer(pro.token) })).ok()).toBeTruthy();
  expect((await ctx.post(`${API}/jobs/${job}/en-route`, { headers: bearer(pro.token) })).ok()).toBeTruthy();
  await ctx.post(`${API}/jobs/${job}/photos`, { headers: bearer(pro.token), data: { kind: "BEFORE", url: "http://x/b.jpg" } });
  expect((await ctx.post(`${API}/jobs/${job}/arrived`, { headers: bearer(pro.token) })).ok()).toBeTruthy();
  expect((await ctx.post(`${API}/jobs/${job}/start`, { headers: bearer(pro.token) })).ok()).toBeTruthy();

  // Provider proposes a $50 add-on; customer approves → charged immediately, job → APPROVED.
  const addOnCents = 5000;
  expect(
    (await ctx.post(`${API}/jobs/${job}/adjustments`, { headers: bearer(pro.token), data: { items: [{ description: "Extra debris", priceCents: addOnCents }] } })).ok(),
  ).toBeTruthy();
  expect((await ctx.post(`${API}/jobs/${job}/adjustments/approve`, { headers: bearer(cust.token) })).ok()).toBeTruthy();

  // The customer really was charged for the add-on (captured).
  let custPayments = await (await ctx.get(`${API}/payments/mine`, { headers: bearer(cust.token) })).json();
  const addOn = custPayments.find((p: any) => p.jobId === job && p.type === "ADDON");
  expect(addOn).toBeTruthy();
  expect(addOn.amountCents).toBe(addOnCents);
  expect(addOn.status).toBe("CAPTURED");

  // Customer cancels the APPROVED job.
  const cancel = await ctx.post(`${API}/jobs/${job}/cancel`, { headers: bearer(cust.token) });
  expect(cancel.ok()).toBeTruthy();
  const cancelBody = await cancel.json();

  const baseOnlyFee = Math.round(base * 0.25);
  const wrongCombinedFee = Math.round((base + addOnCents) * 0.25);
  // Finding #2: an APPROVED (post-arrival) job is AFTER_EN_ROUTE (25%), not the flat $10 tier.
  expect(cancelBody.cancellationFeeCents).not.toBe(1000);
  // Finding #1a: the 25% is of BASE only — never a slice of add-ons the customer already paid.
  expect(cancelBody.cancellationFeeCents).toBe(baseOnlyFee);
  expect(cancelBody.cancellationFeeCents).not.toBe(wrongCombinedFee);

  custPayments = await (await ctx.get(`${API}/payments/mine`, { headers: bearer(cust.token) })).json();

  // Finding #1b: the captured add-on is refunded to the customer, not stranded in the platform.
  const settledAddOn = custPayments.find((p: any) => p.jobId === job && p.type === "ADDON");
  expect(settledAddOn.status).toBe("REFUNDED");
  expect(settledAddOn.refundedAmountCents).toBe(addOnCents);

  // The cancellation fee row is the base-only amount.
  const fee = custPayments.find((p: any) => p.jobId === job && p.type === "CANCELLATION_FEE");
  expect(fee.amountCents).toBe(baseOnlyFee);
  expect(fee.status).toBe("CAPTURED");
});

test("a DECLINED-addons job is still cancellable, and the cancel reason is captured", async () => {
  const pro = await registerProvider();
  await activateProvider(pro.id, pro.token);
  const cust = await registerCustomer();

  const job = await createJob(cust.token);
  await ctx.post(`${API}/jobs/${job}/claim`, { headers: bearer(pro.token) });
  await ctx.post(`${API}/jobs/${job}/en-route`, { headers: bearer(pro.token) });
  await ctx.post(`${API}/jobs/${job}/photos`, { headers: bearer(pro.token), data: { kind: "BEFORE", url: "http://x/b.jpg" } });
  await ctx.post(`${API}/jobs/${job}/arrived`, { headers: bearer(pro.token) });
  await ctx.post(`${API}/jobs/${job}/start`, { headers: bearer(pro.token) });

  // Provider proposes add-ons; customer DECLINES → job status DECLINED (a completable state,
  // not terminal).
  await ctx.post(`${API}/jobs/${job}/adjustments`, { headers: bearer(pro.token), data: { items: [{ description: "Extra debris", priceCents: 3000 }] } });
  const declined = await ctx.post(`${API}/jobs/${job}/adjustments/decline`, { headers: bearer(cust.token) });
  expect(declined.ok()).toBeTruthy();
  expect((await declined.json()).status).toBe("DECLINED");

  // Finding #1: a DECLINED job used to be wrongly treated as terminal → 409. It must now cancel.
  // Finding #2: the free-text reason is captured (brief B8).
  const reason = "Changed my mind about the extra work";
  const cancel = await ctx.post(`${API}/jobs/${job}/cancel`, { headers: bearer(cust.token), data: { reason } });
  expect(cancel.ok()).toBeTruthy();
  const body = await cancel.json();
  expect(body.status).toBe("CANCELLED");
  expect(body.cancellationReason).toBe(reason);
});
