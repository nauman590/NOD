import { test, expect, request as pwRequest, APIRequestContext } from "@playwright/test";

const API = "http://localhost:3001/api";

// Live third-party integration coverage: Google Maps (server key) and Twilio SMS.
//
// Everywhere else in the suite these integrations are allowed to be gracefully stubbed —
// distance falls back to a constant, SMS is logged instead of sent — so the specs stay
// green on a keyless dev box. THIS spec is the opposite: it asserts the real wiring.
// It self-skips when GET /admin/integrations reports the integration as not configured,
// so it stays green without keys and becomes meaningful the moment they're set.
//
// What it proves with keys present:
//   1. /admin/integrations reports what's wired, leaks no secrets, and is admin-only.
//   2. Maps geocoding is REAL: distance tracks the actual address, it isn't the fallback.
//   3. The service-radius broadcast gate uses that real distance (far job → no broadcast).
//   4. The live ETA is computed from the provider's GPS point and shrinks as they close in.

let ctx: APIRequestContext;
let adminTok: string;
let categoryId: string;
let integrations: any;
// Throwaway categories created by a test; deactivated in afterAll so they never linger in
// the public category list the customer app renders.
const tempCategoryIds: string[] = [];

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const uniq = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

// Real Stripe + real Google geocode round-trips per test — the 30s default is tight.
test.describe.configure({ timeout: 120_000 });

async function registerProvider() {
  const email = `li_pro_${uniq()}@nod.app`;
  const res = await ctx.post(`${API}/auth/register/provider`, {
    data: {
      email,
      phone: `+1555${Date.now() % 10000000}`,
      password: "provider1234",
      fullName: "Live Integrations Pro",
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

async function registerCustomer() {
  const res = await ctx.post(`${API}/auth/register/customer`, {
    data: { email: `li_cust_${uniq()}@nod.app`, password: "secret123", fullName: "Live Cust" },
  });
  expect(res.ok()).toBeTruthy();
  return { token: (await res.json()).accessToken as string };
}

// Same registration, but returns both tokens — the SPA needs the refresh token too.
async function registerCustomerFull() {
  const res = await ctx.post(`${API}/auth/register/customer`, {
    data: { email: `li_cust_${uniq()}@nod.app`, password: "secret123", fullName: "Live Cust" },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { accessToken: body.accessToken as string, refreshToken: body.refreshToken as string };
}

async function estimateFor(address: string, categorySlug = "junk") {
  const res = await ctx.post(`${API}/estimate`, {
    data: { categorySlug, description: "Old sofa and boxes", serviceAddress: address },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function createJobAt(customerToken: string, address: string, categorySlug = "junk") {
  const est = await estimateFor(address, categorySlug);
  const res = await ctx.post(`${API}/jobs`, { headers: bearer(customerToken), data: { estimateId: est.estimateId } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id as string;
}

async function newJobNotificationCount(userToken: string) {
  const list = await (await ctx.get(`${API}/notifications`, { headers: bearer(userToken) })).json();
  return (list as any[]).filter((n) => n.template === "NEW_JOB_AVAILABLE").length;
}

test.beforeAll(async () => {
  ctx = await pwRequest.newContext();
  const admin = await (
    await ctx.post(`${API}/auth/login`, { data: { emailOrPhone: "admin@nod.app", password: "admin1234" } })
  ).json();
  adminTok = admin.accessToken;
  const cats = await (await ctx.get(`${API}/categories`)).json();
  categoryId = cats.find((c: any) => c.slug === "junk").id;
  integrations = await (await ctx.get(`${API}/admin/integrations`, { headers: bearer(adminTok) })).json();
});

test.afterAll(async () => {
  for (const id of tempCategoryIds) {
    await ctx.delete(`${API}/categories/${id}`, { headers: bearer(adminTok) }).catch(() => undefined);
  }
  await ctx.dispose();
});

test.describe("Integration status endpoint", () => {
  test("reports each integration and never echoes a secret", async () => {
    expect(integrations).toMatchObject({
      maps: { enabled: expect.any(Boolean) },
      sms: { enabled: expect.any(Boolean), usesMessagingService: expect.any(Boolean) },
      stripe: { enabled: expect.any(Boolean) },
      checkr: { enabled: expect.any(Boolean) },
      ai: { provider: expect.any(String) },
    });
    // A key must never round-trip to the client. Google keys start "AIza", Twilio SIDs
    // "AC", Stripe secrets "sk_" — none may appear anywhere in the payload.
    const blob = JSON.stringify(integrations);
    expect(blob).not.toMatch(/AIza|\bAC[0-9a-f]{32}\b|sk_(test|live)_/);
  });

  test("is admin-only", async () => {
    const cust = await registerCustomer();
    const res = await ctx.get(`${API}/admin/integrations`, { headers: bearer(cust.token) });
    expect(res.status()).toBe(403);
  });
});

test.describe("Google Maps (server key)", () => {
  test.skip(() => !integrations?.maps?.enabled, "GOOGLE_MAPS_SERVER_KEY not configured");

  test("pool distance is really geocoded — a far address prices a bigger trip fee", async () => {
    // Both addresses are real and ~80 miles apart. Without a working key the service
    // returns the SAME fallback constant for both, so a strict inequality here is the
    // proof that the Geocoding API was actually called.
    const near = await estimateFor("1280 Peachtree St NE, Atlanta, GA 30309");
    const far = await estimateFor("Athens, GA");

    const nearMi = near.breakdown.poolDistanceMiles;
    const farMi = far.breakdown.poolDistanceMiles;
    expect(nearMi).toBeGreaterThan(0);
    expect(farMi).toBeGreaterThan(nearMi * 3);
    // Downtown Atlanta is within a few miles of the hub; Athens is well outside it.
    expect(nearMi).toBeLessThan(integrations.maps.jobRadiusMiles);
    expect(farMi).toBeGreaterThan(integrations.maps.jobRadiusMiles);
    // ...and that distance is priced into the trip fee, not just reported.
    expect(far.breakdown.tripCents).toBeGreaterThan(near.breakdown.tripCents);
  });

  test("service-radius gate: a job outside the radius is not broadcast to providers", async () => {
    // Run in a throwaway category so this provider is the ONLY candidate for the
    // broadcast. Against a shared category the per-job notify cap decides who hears about
    // a job, and a freshly-created provider legitimately may not make the cut — which
    // would make this assertion about the cap rather than about the distance gate.
    const slug = `li-radius-${uniq()}`;
    const cat = await (
      await ctx.post(`${API}/categories`, {
        headers: bearer(adminTok),
        data: { slug, name: "Live Integrations Radius", promptTemplate: "Price this task.", intakeConfig: {} },
      })
    ).json();
    tempCategoryIds.push(cat.id);

    const pro = await registerProvider();
    await ctx.post(`${API}/admin/providers/${pro.id}/background`, {
      headers: bearer(adminTok),
      data: { result: "PASSED" },
    });
    await ctx.post(`${API}/admin/providers/${pro.id}/approve`, { headers: bearer(adminTok) });
    await ctx.put(`${API}/providers/me/rates`, {
      headers: bearer(pro.token),
      data: { rates: [{ categoryId: cat.id, hourlyRateCents: 6000, active: true }] },
    });
    const cust = await registerCustomer();

    // The broadcast is dispatched after the create response returns (it geocodes first),
    // so both halves are polled rather than read once.

    // Inside the 15-mile radius → the provider is notified.
    await createJobAt(cust.token, "1280 Peachtree St NE, Atlanta, GA 30309", slug);
    await expect.poll(() => newJobNotificationCount(pro.token), { timeout: 15_000 }).toBe(1);

    // Outside it → suppressed. Settle for well longer than the in-radius broadcast just
    // took, so a still-empty count means "never sent", not "not sent yet".
    await createJobAt(cust.token, "Athens, GA", slug);
    await new Promise((r) => setTimeout(r, 8000));
    expect(await newJobNotificationCount(pro.token)).toBe(1);
  });

  test("live ETA is computed from the provider's GPS point and shrinks as they approach", async () => {
    const pro = await registerProvider();
    await activateProvider(pro.id, pro.token);
    const cust = await registerCustomer();
    const address = "1280 Peachtree St NE, Atlanta, GA 30309";
    const job = await createJobAt(cust.token, address);

    expect((await ctx.post(`${API}/jobs/${job}/claim`, { headers: bearer(pro.token) })).ok()).toBeTruthy();
    expect((await ctx.post(`${API}/jobs/${job}/en-route`, { headers: bearer(pro.token) })).ok()).toBeTruthy();

    // ~10 miles north of the destination.
    const far = await (
      await ctx.post(`${API}/jobs/${job}/location`, { headers: bearer(pro.token), data: { lat: 33.9304, lng: -84.3733 } })
    ).json();
    expect(far.etaMinutes).toBeGreaterThan(0);

    // Practically on top of it — the ETA must fall.
    const close = await (
      await ctx.post(`${API}/jobs/${job}/location`, { headers: bearer(pro.token), data: { lat: 33.7901, lng: -84.3846 } })
    ).json();
    expect(close.etaMinutes).toBeLessThan(far.etaMinutes);

    // The first post-en-route ping freezes the dispatch ETA that lateness is judged
    // against; it must NOT drift down with the live value.
    const detail = await (await ctx.get(`${API}/jobs/${job}`, { headers: bearer(cust.token) })).json();
    expect(detail.etaMinutes).toBe(close.etaMinutes);
  });
});

test.describe("Google Maps (browser key)", () => {
  test("the customer tracking page renders a real Google map, not the keyless fallback", async ({ page }) => {
    // The browser key is a separate Vite build-time var from the server key, so it gets
    // its own check: the fallback card and the map are mutually exclusive branches of
    // LiveTrackingMap, and only a loaded Maps JS API produces the map's own DOM.
    const pro = await registerProvider();
    await activateProvider(pro.id, pro.token);
    const cust = await registerCustomerFull();
    const job = await createJobAt(cust.accessToken, "1280 Peachtree St NE, Atlanta, GA 30309");

    await ctx.post(`${API}/jobs/${job}/claim`, { headers: bearer(pro.token) });
    await ctx.post(`${API}/jobs/${job}/en-route`, { headers: bearer(pro.token) });
    await ctx.post(`${API}/jobs/${job}/location`, { headers: bearer(pro.token), data: { lat: 33.7901, lng: -84.3846 } });

    await page.addInitScript(
      ([a, r]: [string, string]) => {
        localStorage.setItem("nod_access", a);
        localStorage.setItem("nod_refresh", r);
      },
      [cust.accessToken, cust.refreshToken],
    );
    await page.goto(`/job/${job}`);

    // Keyless build → this copy is shown instead of a map.
    await expect(page.getByText("The live map appears here once the Google Maps key is added.")).toHaveCount(0);
    // Google's loader injects its script and stamps the container with .gm-style.
    await expect(page.locator('script[src*="maps.googleapis.com/maps/api/js"]')).toHaveCount(1);
    await expect(page.locator(".gm-style")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/ETA ~\d+ min/)).toBeVisible();
  });
});

test.describe("Twilio SMS", () => {
  test.skip(() => !integrations?.sms?.enabled, "Twilio not configured");

  test("a real send is attempted and its outcome is reported honestly", async () => {
    // A structurally invalid destination is rejected BY TWILIO (error 21211) — which can
    // only happen if the credentials authenticated. The API must report sent:false rather
    // than claiming success, and must still surface devCode so the flow stays testable.
    const cust = await registerCustomer();
    const res = await ctx.post(`${API}/auth/phone/request-otp`, {
      headers: bearer(cust.token),
      data: { phone: `+1555${Date.now() % 10000000}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sent).toBe(false);
    expect(body.devCode).toMatch(/^\d{6}$/);
  });

  test("a deliverable number reports sent:true and withholds the code", async () => {
    // Opt-in: only runs when E2E_SMS_TO is set to a number you own. It sends a REAL text
    // (billed at the destination's rate), so it is off by default.
    //
    // If this fails with sent:false, check the API log for Twilio's reason before
    // suspecting the app — the usual causes are account settings, not code:
    //   21408 → that country isn't enabled under Messaging → Settings → Geo permissions
    //   21606 → TWILIO_FROM can't send to that destination (e.g. a US long code abroad)
    const to = process.env.E2E_SMS_TO;
    test.skip(!to, "set E2E_SMS_TO=+1... to exercise a real SMS delivery");

    const cust = await registerCustomer();
    const res = await ctx.post(`${API}/auth/phone/request-otp`, {
      headers: bearer(cust.token),
      data: { phone: to },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.sent).toBe(true);
    // Delivered for real → the code must NOT be echoed back over HTTP.
    expect(body.devCode).toBeUndefined();
  });
});
