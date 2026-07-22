import { test, expect } from "@playwright/test";

const API = "http://localhost:3001/api";

// Cross-role navigation must redirect, never dead-end.
//
// The customer screens (/my-jobs, /account, /job/:id) query CUSTOMER-guarded endpoints.
// They used to render for any signed-in user, so a provider or admin who landed on one got
// an "Insufficient role" error modal and no way forward — the page had nothing else to
// show. Each is now behind RequireRole, which bounces a mismatched session to its own home.
//
// Rating and dispute reporting stay open to both sides on purpose: the brief makes both
// two-way and the provider dashboard links straight to /job/:id/report.

const uniq = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function seedSession(page: any, accessToken: string, refreshToken: string) {
  await page.addInitScript(
    ([a, r]: [string, string]) => {
      localStorage.setItem("nod_access", a);
      localStorage.setItem("nod_refresh", r);
    },
    [accessToken, refreshToken],
  );
}

async function activeProviderSession(page: any, request: any) {
  const admin = await (
    await request.post(`${API}/auth/login`, { data: { emailOrPhone: "admin@nod.app", password: "admin1234" } })
  ).json();
  const reg = await (
    await request.post(`${API}/auth/register/provider`, {
      data: {
        email: `rr_pro_${uniq()}@nod.app`,
        phone: `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
        password: "provider1234",
        fullName: "Role Routing Pro",
        licenseUrl: "http://x/license.jpg",
        profilePhotoUrl: "http://x/pro.jpg",
      },
    })
  ).json();
  const categoryId = (await (await request.get(`${API}/categories`)).json()).find((c: any) => c.slug === "junk").id;
  await request.post(`${API}/admin/providers/${reg.provider.id}/background`, {
    headers: bearer(admin.accessToken),
    data: { result: "PASSED" },
  });
  await request.post(`${API}/admin/providers/${reg.provider.id}/approve`, { headers: bearer(admin.accessToken) });
  await request.put(`${API}/providers/me/rates`, {
    headers: bearer(reg.accessToken),
    data: { rates: [{ categoryId, hourlyRateCents: 6000, active: true }] },
  });
  await seedSession(page, reg.accessToken, reg.refreshToken);
}

const CUSTOMER_ROUTES = ["/my-jobs", "/account"];

test("a provider sent to a customer screen lands on the provider dashboard", async ({ page, request }) => {
  await activeProviderSession(page, request);

  for (const route of CUSTOMER_ROUTES) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/provider$/);
    // The failure this replaces: the page rendered and surfaced the raw API error.
    await expect(page.getByText("Insufficient role")).toHaveCount(0);
  }
});

test("an admin sent to a customer screen lands on the admin console", async ({ page, request }) => {
  const admin = await (
    await request.post(`${API}/auth/login`, { data: { emailOrPhone: "admin@nod.app", password: "admin1234" } })
  ).json();
  await seedSession(page, admin.accessToken, admin.refreshToken);

  for (const route of CUSTOMER_ROUTES) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByText("Insufficient role")).toHaveCount(0);
  }
});

// Checkout is deliberately NOT role-locked — a guest has to be able to price and buy
// before they have an account. That left a hole: a signed-in provider/admin got the
// create-account fields, and entering their own email 409'd, "recovered" by logging them
// back in as that same non-customer, then failed POST /jobs with a bare "Insufficient
// role". Checkout now names the problem instead of letting them reach that dead end.
test("an admin on checkout is told to use a customer account, not left to fail at payment", async ({ page, request }) => {
  const admin = await (
    await request.post(`${API}/auth/login`, { data: { emailOrPhone: "admin@nod.app", password: "admin1234" } })
  ).json();
  await seedSession(page, admin.accessToken, admin.refreshToken);

  // Price a job as the customer flow does, then land on checkout with that estimate.
  const est = await (
    await request.post(`${API}/estimate`, {
      data: { categorySlug: "junk", description: "Old sofa and boxes", serviceAddress: "500 Peachtree St NE, Atlanta, GA" },
    })
  ).json();
  // Checkout bootstraps from the draft + estimate the customer flow leaves in
  // sessionStorage; without both it redirects home.
  await page.addInitScript((id: string) => {
    sessionStorage.setItem("estimateId", id);
    sessionStorage.setItem(
      "taskDraft",
      JSON.stringify({
        photoUrl: null,
        categorySlug: "junk",
        categoryName: "Junk removal",
        details: "Old sofa and boxes",
        addressMode: "single",
        serviceAddress: "500 Peachtree St NE, Atlanta, GA",
        pickupAddress: "",
        dropoffAddress: "",
      }),
    );
  }, est.estimateId);
  await page.goto("/checkout");

  await expect(page.getByText(/signed in as an admin/i)).toBeVisible();
  await expect(page.getByText(/only customer accounts can book a job/i)).toBeVisible();
  // No create-account fields, and no way to submit into a guaranteed 403.
  await expect(page.getByPlaceholder("you@example.com")).toHaveCount(0);
  await expect(page.getByText("Insufficient role")).toHaveCount(0);
});

test("a customer still reaches their own screens", async ({ page, request }) => {
  const cust = await (
    await request.post(`${API}/auth/register/customer`, {
      data: { email: `rr_cust_${uniq()}@nod.app`, password: "secret123", fullName: "Role Routing Cust" },
    })
  ).json();
  await seedSession(page, cust.accessToken, cust.refreshToken);

  await page.goto("/my-jobs");
  await expect(page).toHaveURL(/\/my-jobs$/);
  await expect(page.getByText("Insufficient role")).toHaveCount(0);
});
