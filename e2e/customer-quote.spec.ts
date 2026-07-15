import { test, expect } from "@playwright/test";

const API = "http://localhost:3001/api";

// A provider-sent quote must be reachable by the customer: My Jobs lists it, and the
// job page lets them approve it.
test("customer can find and approve a provider quote via My Jobs", async ({ page, request }) => {
  // --- setup via API ---
  const cust = (await (await request.post(`${API}/auth/login`, { data: { emailOrPhone: "customer@nod.app", password: "customer1234" } })).json());
  const pro = (await (await request.post(`${API}/auth/login`, { data: { emailOrPhone: "pro1@nod.app", password: "provider1234" } })).json());
  const auth = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

  const est = await (await request.post(`${API}/estimate`, { data: { categorySlug: "junk", description: "Sofa, boxes and an old desk", intakeData: { itemCount: 3 } } })).json();
  const job = await (await request.post(`${API}/jobs`, { ...auth(cust.accessToken), data: { estimateId: est.estimateId, serviceAddress: "500 Peachtree St, Atlanta" } })).json();
  await request.post(`${API}/jobs/${job.id}/claim`, auth(pro.accessToken));
  await request.post(`${API}/jobs/${job.id}/adjustments`, { ...auth(pro.accessToken), data: { items: [{ description: "Extra mattress haul", priceCents: 4500 }] } });

  // --- customer browses ---
  await page.addInitScript(([a, r]: string[]) => { localStorage.setItem("nod_access", a); localStorage.setItem("nod_refresh", r); }, [cust.accessToken, cust.refreshToken]);

  // My Jobs link is on the home page
  await page.goto("/");
  await page.getByRole("link", { name: /My jobs/i }).click();
  await expect(page).toHaveURL(/\/my-jobs/);

  // the quote is highlighted
  await expect(page.getByText(/Quote to review/i)).toBeVisible({ timeout: 15000 });

  // open the job and approve
  await page.getByText(/Quote to review/i).first().click();
  await expect(page).toHaveURL(/\/job\//);
  const approve = page.getByRole("button", { name: /Approve · pay/i });
  await expect(approve).toBeVisible({ timeout: 15000 });
  await approve.click();
  await expect(page.getByText("Extra mattress haul")).toBeVisible();
});
