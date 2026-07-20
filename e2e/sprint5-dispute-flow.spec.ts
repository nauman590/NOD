import { test, expect, request as pwRequest, APIRequestContext } from "@playwright/test";

const API = "http://localhost:3001/api";

// Sprint 5 — Admin & Dispute Flow. Drives the REAL API end-to-end:
//   1. dispute photos, uploadable + viewable by BOTH parties
//   2. "additional charge" resolution outcome
//   3. manual rating adjustments (admin edit / delete → aggregate recompute)
//   4a. report accessible from a completed job (provider views + participates)
//   4b. ledger claw-back on a post-completion refund → deducted from next payout

let ctx: APIRequestContext;
let adminTok: string;
let categoryId: string;
let proTok: string;
let proId: string;
let proUserId: string;
let custTok: string;
let custUserId: string;

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const uniq = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

// Each test runs one or more full real-Stripe job lifecycles; give ample headroom.
test.describe.configure({ timeout: 120_000 });

async function activeProvider() {
  const email = `s5_pro_${uniq()}@nod.app`;
  const reg = await (
    await ctx.post(`${API}/auth/register/provider`, { data: { email, phone: `+1555${Date.now() % 10000000}`, password: "provider1234", fullName: "S5 Pro" } })
  ).json();
  await ctx.post(`${API}/admin/providers/${reg.provider.id}/background`, { headers: bearer(adminTok), data: { result: "PASSED" } });
  await ctx.post(`${API}/admin/providers/${reg.provider.id}/approve`, { headers: bearer(adminTok) });
  await ctx.put(`${API}/providers/me/rates`, { headers: bearer(reg.accessToken), data: { rates: [{ categoryId, hourlyRateCents: 6000, active: true }] } });
  return { token: reg.accessToken as string, id: reg.provider.id as string, userId: reg.user.id as string };
}

async function newCustomer() {
  const email = `s5_cust_${uniq()}@nod.app`;
  const reg = await (await ctx.post(`${API}/auth/register/customer`, { data: { email, password: "secret123", fullName: "S5 Cust" } })).json();
  return { token: reg.accessToken as string, userId: reg.user.id as string };
}

async function createJob(customerToken: string) {
  const est = await (
    await ctx.post(`${API}/estimate`, { data: { categorySlug: "junk", description: "Old sofa and boxes", serviceAddress: "500 Peachtree St NE, Atlanta, GA" } })
  ).json();
  const res = await ctx.post(`${API}/jobs`, { headers: bearer(customerToken), data: { estimateId: est.estimateId } });
  return (await res.json()).id as string;
}

// Claim → before photo → arrive → start → after photo → complete. Returns payoutCents.
async function runJob(jobId: string): Promise<number> {
  await ctx.post(`${API}/jobs/${jobId}/claim`, { headers: bearer(proTok) });
  await ctx.post(`${API}/jobs/${jobId}/en-route`, { headers: bearer(proTok) });
  await ctx.post(`${API}/jobs/${jobId}/photos`, { headers: bearer(proTok), data: { kind: "BEFORE", url: "http://x/b.jpg" } });
  await ctx.post(`${API}/jobs/${jobId}/arrived`, { headers: bearer(proTok) });
  await ctx.post(`${API}/jobs/${jobId}/start`, { headers: bearer(proTok) });
  await ctx.post(`${API}/jobs/${jobId}/photos`, { headers: bearer(proTok), data: { kind: "AFTER", url: "http://x/a.jpg" } });
  const cmp = await (await ctx.post(`${API}/jobs/${jobId}/complete`, { headers: bearer(proTok) })).json();
  return cmp.payoutCents as number;
}

test.beforeAll(async () => {
  ctx = await pwRequest.newContext();
  adminTok = (await (await ctx.post(`${API}/auth/login`, { data: { emailOrPhone: "admin@nod.app", password: "admin1234" } })).json()).accessToken;
  categoryId = (await (await ctx.get(`${API}/categories`)).json()).find((c: any) => c.slug === "junk").id;
  const pro = await activeProvider();
  proTok = pro.token; proId = pro.id; proUserId = pro.userId;
  const cust = await newCustomer();
  custTok = cust.token; custUserId = cust.userId;
});

test.afterAll(async () => { await ctx.dispose(); });

test.describe.serial("Sprint 5 dispute flow", () => {
  let job1: string;
  let pay1: number;
  let dispute1: string;

  test("item 1/4a: dispute photos, opened on a completed job, visible to both parties", async () => {
    job1 = await createJob(custTok);
    pay1 = await runJob(job1);
    expect(pay1).toBeGreaterThan(0);

    // Customer opens a dispute WITH photos on a COMPLETED job.
    const disp = await (
      await ctx.post(`${API}/jobs/${job1}/disputes`, {
        headers: bearer(custTok),
        data: { reason: "Quality of work", description: "scratches", photoUrls: ["http://x/d1.jpg", "http://x/d2.jpg"] },
      })
    ).json();
    dispute1 = disp.id;
    expect(disp.photos.length).toBe(2);

    // Provider can view the dispute on their job and add their own evidence photo.
    const provView = await (await ctx.get(`${API}/jobs/${job1}/disputes`, { headers: bearer(proTok) })).json();
    expect(provView.some((d: any) => d.id === dispute1)).toBe(true);
    await ctx.post(`${API}/disputes/${dispute1}/photos`, { headers: bearer(proTok), data: { url: "http://x/prov.jpg" } });

    // Admin queue shows all three photos with uploader attribution.
    const queue = await (await ctx.get(`${API}/admin/disputes`, { headers: bearer(adminTok) })).json();
    const row = queue.find((d: any) => d.id === dispute1);
    expect(row.photos.length).toBe(3);
    expect(row.photos.every((p: any) => p.uploader)).toBe(true);
  });

  test("item 4b: post-completion refund records a claw-back deducted from the next payout", async () => {
    const res = await (
      await ctx.patch(`${API}/admin/disputes/${dispute1}`, { headers: bearer(adminTok), data: { status: "RESOLVED", resolution: "partial", refundCents: 1500 } })
    ).json();
    expect(res.refundedCents).toBe(1500);
    expect(res.clawbackCents).toBe(1500);

    // The provider's NEXT payout is reduced by the clawed-back amount.
    const job2 = await createJob(custTok);
    const pay2 = await runJob(job2);
    expect(pay2).toBe(pay1 - 1500);
  });

  test("item 2: additional-charge outcome charges the customer and is mutually exclusive with refunds", async () => {
    const job3 = await createJob(custTok);
    await runJob(job3);
    const d = await (await ctx.post(`${API}/jobs/${job3}/disputes`, { headers: bearer(custTok), data: { reason: "Damage", description: "extra work" } })).json();

    const res = await (
      await ctx.patch(`${API}/admin/disputes/${d.id}`, { headers: bearer(adminTok), data: { status: "RESOLVED", resolution: "charge", additionalChargeCents: 2500 } })
    ).json();
    expect(res.chargedCents).toBe(2500);

    const payments = await (await ctx.get(`${API}/payments/mine`, { headers: bearer(custTok) })).json();
    expect(payments.some((p: any) => p.type === "DISPUTE_CHARGE" && p.amountCents === 2500)).toBe(true);

    // Refund + charge together is rejected.
    const both = await ctx.patch(`${API}/admin/disputes/${d.id}`, { headers: bearer(adminTok), data: { status: "RESOLVED", refundCents: 100, additionalChargeCents: 100 } });
    expect(both.status()).toBe(400);
  });

  test("item 3: admin can edit and delete ratings, and the aggregate recomputes", async () => {
    // Ratings exist on the completed job1 (both directions).
    await ctx.post(`${API}/jobs/${job1}/rate`, { headers: bearer(proTok), data: { stars: 5 } });
    await ctx.post(`${API}/jobs/${job1}/rate`, { headers: bearer(custTok), data: { stars: 5 } });

    const proRatings = await (await ctx.get(`${API}/admin/users/${proUserId}/ratings`, { headers: bearer(adminTok) })).json();
    expect(proRatings.length).toBeGreaterThan(0);
    const rid = proRatings[0].id;

    // Edit → aggregate follows.
    await ctx.patch(`${API}/admin/ratings/${rid}`, { headers: bearer(adminTok), data: { stars: 2 } });
    let providers = await (await ctx.get(`${API}/admin/providers?status=ACTIVE`, { headers: bearer(adminTok) })).json();
    expect(providers.find((p: any) => p.id === proId).ratingAvg).toBe(2);

    // Delete → count follows.
    await ctx.delete(`${API}/admin/ratings/${rid}`, { headers: bearer(adminTok) });
    providers = await (await ctx.get(`${API}/admin/providers?status=ACTIVE`, { headers: bearer(adminTok) })).json();
    expect(providers.find((p: any) => p.id === proId).ratingCount).toBe(0);

    // Customer ratings are adjustable too.
    const custRatings = await (await ctx.get(`${API}/admin/users/${custUserId}/ratings`, { headers: bearer(adminTok) })).json();
    expect(custRatings.length).toBeGreaterThan(0);
    const upd = await (await ctx.patch(`${API}/admin/ratings/${custRatings[0].id}`, { headers: bearer(adminTok), data: { stars: 3 } })).json();
    expect(upd.rating.stars).toBe(3);
  });

  test("item 4a: a provider can open a dispute from their side of the job", async () => {
    const job = await createJob(custTok);
    await ctx.post(`${API}/jobs/${job}/claim`, { headers: bearer(proTok) });
    const d = await ctx.post(`${API}/jobs/${job}/disputes`, { headers: bearer(proTok), data: { reason: "Safety concern", description: "unsafe site", photoUrls: ["http://x/p1.jpg"] } });
    expect(d.ok()).toBeTruthy();
    expect((await d.json()).photos.length).toBe(1);
  });
});
