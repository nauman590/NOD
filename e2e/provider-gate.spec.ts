import { test, expect } from "@playwright/test";

const API = "http://localhost:3001/api";

async function loginAs(page: any, request: any, body: any) {
  const res = await request.post(`${API}/auth/login`, { data: body });
  const { accessToken, refreshToken } = await res.json();
  await page.addInitScript(
    ([a, r]: string[]) => {
      localStorage.setItem("nod_access", a);
      localStorage.setItem("nod_refresh", r);
    },
    [accessToken, refreshToken],
  );
}

test("pending provider sees approval screen, not the jobs board", async ({ page, request }) => {
  // fresh provider = PENDING_APPROVAL
  const email = `gate_${Date.now()}@nod.app`;
  const reg = await request.post(`${API}/auth/register/provider`, {
    data: { email, phone: `+1333${Date.now() % 10000000}`, password: "provider1234", fullName: "Gate Test", licenseUrl: "http://x/license.jpg", profilePhotoUrl: "http://x/pro.jpg" },
  });
  const { accessToken, refreshToken } = await reg.json();
  await page.addInitScript(([a, r]: string[]) => { localStorage.setItem("nod_access", a); localStorage.setItem("nod_refresh", r); }, [accessToken, refreshToken]);

  await page.goto("/provider");
  await expect(page.getByText("Your account is pending approval")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("link", { name: /Complete provider setup/i })).toBeVisible();
  // jobs board tabs should NOT be shown
  await expect(page.getByRole("button", { name: /^available/i })).toHaveCount(0);

  // header account menu → Account settings reachable
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("link", { name: /Payouts & setup/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Account settings/i })).toBeVisible();
});

test("provider signup requires a driver's license and profile photo (brief)", async ({ request }) => {
  const suffix = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const core = () => ({ phone: `+1333${Math.floor(Math.random() * 1e7)}`, password: "provider1234", fullName: "Missing Docs" });

  // Neither document → rejected.
  const none = await request.post(`${API}/auth/register/provider`, {
    data: { email: `gate_nodocs_${suffix()}@nod.app`, ...core() },
  });
  expect(none.status()).toBe(400);

  // License present but no profile photo → still rejected.
  const noPhoto = await request.post(`${API}/auth/register/provider`, {
    data: { email: `gate_nophoto_${suffix()}@nod.app`, ...core(), licenseUrl: "http://x/license.jpg" },
  });
  expect(noPhoto.status()).toBe(400);

  // Both present → accepted.
  const ok = await request.post(`${API}/auth/register/provider`, {
    data: { email: `gate_ok_${suffix()}@nod.app`, ...core(), licenseUrl: "http://x/license.jpg", profilePhotoUrl: "http://x/pro.jpg" },
  });
  expect(ok.ok()).toBeTruthy();
});

test("active provider sees the jobs board", async ({ page, request }) => {
  await loginAs(page, request, { emailOrPhone: "naumantech35@gmail.com", password: "demo1234" });
  await page.goto("/provider");
  await expect(page.getByRole("button", { name: /^available/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Your account is pending approval")).toHaveCount(0);
});
