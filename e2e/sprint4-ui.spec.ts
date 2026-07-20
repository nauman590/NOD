import { test, expect } from "@playwright/test";
import path from "path";

const API = "http://localhost:3001/api";
const FIXTURE = path.join(__dirname, "fixture.png");
const uniq = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

// Some tests seed a full real-Stripe job lifecycle before driving the UI; give headroom.
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

// Item 5 — a customer can add a profile photo, and it persists across reloads.
test("customer can upload a profile photo that persists", async ({ page, request }) => {
  const email = `s4ui_cust_${uniq()}@nod.app`;
  const reg = await (await request.post(`${API}/auth/register/customer`, { data: { email, password: "secret123", fullName: "Photo Cust" } })).json();
  await seedTokens(page, reg.accessToken, reg.refreshToken);

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();

  // Upload via the hidden avatar file input.
  await page.setInputFiles('input[type="file"]', FIXTURE);

  // The avatar image appears once the upload + PATCH finish.
  await expect(page.getByAltText("Your profile")).toBeVisible({ timeout: 15000 });

  // Reload — the photo is persisted server-side, so it comes back.
  await page.reload();
  await expect(page.getByAltText("Your profile")).toBeVisible({ timeout: 15000 });
});

// Item 4 — a filed off-platform report shows in the admin queue with the ban action.
test("admin off-platform queue lists a pending report with Verify & ban", async ({ page, request }) => {
  // Build a pending report via the API: admin + active provider + customer + claimed job.
  const admin = await (await request.post(`${API}/auth/login`, { data: { emailOrPhone: "admin@nod.app", password: "admin1234" } })).json();
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const cats = await (await request.get(`${API}/categories`)).json();
  const categoryId = cats.find((c: any) => c.slug === "junk").id;

  const proReg = await (
    await request.post(`${API}/auth/register/provider`, {
      data: { email: `s4ui_pro_${uniq()}@nod.app`, phone: `+1555${Date.now() % 10000000}`, password: "provider1234", fullName: "UI Pro", licenseUrl: "http://x/license.jpg", profilePhotoUrl: "http://x/pro.jpg" },
    })
  ).json();
  await request.post(`${API}/admin/providers/${proReg.provider.id}/background`, { headers: bearer(admin.accessToken), data: { result: "PASSED" } });
  await request.post(`${API}/admin/providers/${proReg.provider.id}/approve`, { headers: bearer(admin.accessToken) });
  await request.put(`${API}/providers/me/rates`, { headers: bearer(proReg.accessToken), data: { rates: [{ categoryId, hourlyRateCents: 6000, active: true }] } });

  const custReg = await (await request.post(`${API}/auth/register/customer`, { data: { email: `s4ui_c_${uniq()}@nod.app`, password: "secret123", fullName: "UI Cust" } })).json();
  const est = await (await request.post(`${API}/estimate`, { data: { categorySlug: "junk", description: "Boxes", serviceAddress: "500 Peachtree St NE, Atlanta, GA" } })).json();
  const job = await (await request.post(`${API}/jobs`, { headers: bearer(custReg.accessToken), data: { estimateId: est.estimateId } })).json();
  await request.post(`${API}/jobs/${job.id}/claim`, { headers: bearer(proReg.accessToken) });

  const marker = `venmo-me-${uniq()}`;
  await request.post(`${API}/jobs/${job.id}/report-off-platform`, { headers: bearer(custReg.accessToken), data: { description: marker } });

  // Now view the admin off-platform queue in the UI.
  await seedTokens(page, admin.accessToken, admin.refreshToken);
  await page.goto("/admin/off-platform");
  await expect(page.getByRole("heading", { name: /Off-platform payment reports/i })).toBeVisible();
  await expect(page.getByText(marker)).toBeVisible({ timeout: 15000 });
  // The row exposes both actions.
  await expect(page.getByRole("button", { name: "Verify & ban" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Dismiss" }).first()).toBeVisible();
});

// Item 2 — the provider dashboard exposes a "Completed" tab alongside available/active.
test("provider dashboard shows a Completed tab", async ({ page, request }) => {
  const admin = await (await request.post(`${API}/auth/login`, { data: { emailOrPhone: "admin@nod.app", password: "admin1234" } })).json();
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const cats = await (await request.get(`${API}/categories`)).json();
  const categoryId = cats.find((c: any) => c.slug === "junk").id;

  const proReg = await (
    await request.post(`${API}/auth/register/provider`, {
      data: { email: `s4ui_pro2_${uniq()}@nod.app`, phone: `+1555${Date.now() % 10000000}`, password: "provider1234", fullName: "Tab Pro", licenseUrl: "http://x/license.jpg", profilePhotoUrl: "http://x/pro.jpg" },
    })
  ).json();
  await request.post(`${API}/admin/providers/${proReg.provider.id}/background`, { headers: bearer(admin.accessToken), data: { result: "PASSED" } });
  await request.post(`${API}/admin/providers/${proReg.provider.id}/approve`, { headers: bearer(admin.accessToken) });
  await request.put(`${API}/providers/me/rates`, { headers: bearer(proReg.accessToken), data: { rates: [{ categoryId, hourlyRateCents: 6000, active: true }] } });

  await seedTokens(page, proReg.accessToken, proReg.refreshToken);
  await page.goto("/provider");
  const completedTab = page.getByRole("button", { name: /completed/i });
  await expect(completedTab).toBeVisible({ timeout: 15000 });
  await completedTab.click();
  await expect(page.getByText("No completed jobs yet.")).toBeVisible();
});
