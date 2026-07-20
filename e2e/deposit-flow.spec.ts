import { test, expect } from "@playwright/test";

const API = "http://localhost:3001/api";

// Verifies the provider deposit now REQUIRES a real card (Stripe Elements),
// instead of silently "collecting" without one. Registers a fresh provider each
// run (idempotent) so the deposit always starts unpaid.
test("provider deposit requires entering a card", async ({ page, request }) => {
  const email = `deptest_${Date.now()}@nod.app`;
  const reg = await request.post(`${API}/auth/register/provider`, {
    data: { email, phone: `+1555${Date.now() % 10000000}`, password: "provider1234", fullName: "Deposit Test", licenseUrl: "http://x/license.jpg", profilePhotoUrl: "http://x/pro.jpg" },
  });
  const { accessToken, refreshToken } = await reg.json();

  // Seed the SPA's auth tokens, then load onboarding as that provider.
  await page.addInitScript(
    ([a, r]) => {
      localStorage.setItem("nod_access", a as string);
      localStorage.setItem("nod_refresh", r as string);
    },
    [accessToken, refreshToken],
  );
  await page.goto("/provider/onboarding");

  const payDeposit = page.getByRole("button", { name: "Pay deposit" });
  await expect(payDeposit).toBeVisible({ timeout: 15000 });
  await payDeposit.click();

  // Deposit modal with a real Stripe card field; pay is blocked until card is complete.
  await expect(page.getByText("Refundable $50 deposit")).toBeVisible();
  const pay = page.getByRole("button", { name: /Pay \$50 deposit/i });
  await expect(pay).toBeDisabled();

  const cardFrame = page.frameLocator('iframe[title="Secure card payment input frame"]');
  await cardFrame.locator('[name="cardnumber"]').fill("4242 4242 4242 4242");
  await cardFrame.locator('[name="exp-date"]').fill("12 / 34");
  await cardFrame.locator('[name="cvc"]').fill("123");
  await cardFrame.locator('[name="postal"]').fill("30303");

  await expect(pay).toBeEnabled();
  await pay.click();

  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByText("On file")).toBeVisible({ timeout: 15000 });
});
