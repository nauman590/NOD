import { test, expect } from "@playwright/test";
import path from "path";

const API = "http://localhost:3001/api";
const FIXTURE = path.join(__dirname, "fixture.png");
const uniq = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

// These tests seed a full real-Stripe job lifecycle (~15 sequential API calls) before
// exercising the UI, so they need more than the default 30s under load.
test.describe.configure({ timeout: 120_000 });

async function seedTokens(page: any, accessToken: string, refreshToken: string) {
  await page.addInitScript(
    ([a, r]: [string, string]) => {
      localStorage.setItem("nod_access", a);
      localStorage.setItem("nod_refresh", r);
    },
    [accessToken, refreshToken],
  );
}

// Build a completed job + an open dispute (with a photo) via the API, returning the
// admin session and the marker text used in the dispute description.
async function seedDisputedJob(request: any) {
  const admin = await (await request.post(`${API}/auth/login`, { data: { emailOrPhone: "admin@nod.app", password: "admin1234" } })).json();
  const categoryId = (await (await request.get(`${API}/categories`)).json()).find((c: any) => c.slug === "junk").id;

  const pro = await (
    await request.post(`${API}/auth/register/provider`, { data: { email: `s5ui_pro_${uniq()}@nod.app`, phone: `+1555${Date.now() % 10000000}`, password: "provider1234", fullName: "UI Pro" } })
  ).json();
  await request.post(`${API}/admin/providers/${pro.provider.id}/background`, { headers: bearer(admin.accessToken), data: { result: "PASSED" } });
  await request.post(`${API}/admin/providers/${pro.provider.id}/approve`, { headers: bearer(admin.accessToken) });
  await request.put(`${API}/providers/me/rates`, { headers: bearer(pro.accessToken), data: { rates: [{ categoryId, hourlyRateCents: 6000, active: true }] } });

  const cust = await (await request.post(`${API}/auth/register/customer`, { data: { email: `s5ui_c_${uniq()}@nod.app`, password: "secret123", fullName: "UI Cust" } })).json();
  const est = await (await request.post(`${API}/estimate`, { data: { categorySlug: "junk", description: "sofa", serviceAddress: "500 Peachtree St NE, Atlanta, GA" } })).json();
  const job = await (await request.post(`${API}/jobs`, { headers: bearer(cust.accessToken), data: { estimateId: est.estimateId } })).json();

  const P = bearer(pro.accessToken);
  await request.post(`${API}/jobs/${job.id}/claim`, { headers: P });
  await request.post(`${API}/jobs/${job.id}/en-route`, { headers: P });
  await request.post(`${API}/jobs/${job.id}/photos`, { headers: P, data: { kind: "BEFORE", url: "http://x/b.jpg" } });
  await request.post(`${API}/jobs/${job.id}/arrived`, { headers: P });
  await request.post(`${API}/jobs/${job.id}/start`, { headers: P });
  await request.post(`${API}/jobs/${job.id}/photos`, { headers: P, data: { kind: "AFTER", url: "http://x/a.jpg" } });
  await request.post(`${API}/jobs/${job.id}/complete`, { headers: P });

  const marker = `ui-dispute-${uniq()}`;
  await request.post(`${API}/jobs/${job.id}/disputes`, { headers: bearer(cust.accessToken), data: { reason: "Quality of work", description: marker, photoUrls: ["http://x/d1.jpg"] } });
  // Rate both directions so the rating adjuster has something to show.
  await request.post(`${API}/jobs/${job.id}/rate`, { headers: bearer(pro.accessToken), data: { stars: 5 } });
  await request.post(`${API}/jobs/${job.id}/rate`, { headers: bearer(cust.accessToken), data: { stars: 5 } });

  return { admin, marker, providerId: pro.provider.id };
}

// Item 1 — Report-Issue UI lets a customer attach an evidence photo, then submit.
test("customer can attach a photo to a dispute in Report-Issue", async ({ page, request }) => {
  const cust = await (await request.post(`${API}/auth/register/customer`, { data: { email: `s5ui_rep_${uniq()}@nod.app`, password: "secret123", fullName: "Rep Cust" } })).json();
  const est = await (await request.post(`${API}/estimate`, { data: { categorySlug: "junk", description: "sofa", serviceAddress: "500 Peachtree St NE, Atlanta, GA" } })).json();
  const job = await (await request.post(`${API}/jobs`, { headers: bearer(cust.accessToken), data: { estimateId: est.estimateId } })).json();

  await seedTokens(page, cust.accessToken, cust.refreshToken);
  await page.goto(`/job/${job.id}/report`);
  await expect(page.getByRole("heading", { name: "Report an issue" })).toBeVisible();

  await page.getByRole("button", { name: "Quality of work" }).click();
  await page.getByPlaceholder("Describe what happened…").fill("scratched my wall");
  // Attach an evidence photo — a thumbnail appears.
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByAltText("evidence 1")).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: /Submit report/i }).click();
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page).toHaveURL(new RegExp(`/job/${job.id}$`));

  // The dispute persisted with the photo.
  const disputes = await (await request.get(`${API}/jobs/${job.id}/disputes`, { headers: bearer(cust.accessToken) })).json();
  expect(disputes[0].photos.length).toBe(1);
});

// Item 2 — admin resolves a dispute via the "Additional charge" outcome in the UI.
test("admin resolves a dispute with an additional charge", async ({ page, request }) => {
  const { admin, marker } = await seedDisputedJob(request);
  await seedTokens(page, admin.accessToken, admin.refreshToken);
  await page.goto("/admin/disputes");

  await expect(page.getByText(marker)).toBeVisible({ timeout: 15000 });
  // Scope to the one dispute card (only the card element carries `bg-card`).
  const card = page.locator("div.bg-card", { hasText: marker });
  // Evidence photo thumbnail is shown.
  await expect(card.getByAltText("evidence").first()).toBeVisible();

  await card.getByRole("button", { name: "Resolve" }).click();
  await page.getByRole("button", { name: "Additional charge" }).click();
  await page.getByLabel("Charge the customer ($)").fill("25");
  await page.getByRole("button", { name: /Resolve \+ charge/i }).click();

  // Resolved disputes stay in the queue but lose their action buttons.
  await expect(card.getByRole("button", { name: "Resolve" })).toHaveCount(0, { timeout: 15000 });
  await expect(card.getByText(/Resolution:/)).toBeVisible();
});

// Item 3 — admin adjusts a provider's rating from the Providers page.
test("admin can open the rating adjuster and edit a rating", async ({ page, request }) => {
  const { admin } = await seedDisputedJob(request);
  await seedTokens(page, admin.accessToken, admin.refreshToken);
  await page.goto("/admin/providers");

  // The rating cell is a button (shows "5.0★ (1) ✎" for our seeded provider). Open one.
  const ratingBtn = page.getByRole("button", { name: /★.*✎/ }).first();
  await expect(ratingBtn).toBeVisible({ timeout: 15000 });
  await ratingBtn.click();

  await expect(page.getByRole("heading", { name: /Ratings —/ })).toBeVisible();
  // Set the first rating to 3 stars, then close.
  await page.getByLabel("Set 3 stars").first().click();
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
});
