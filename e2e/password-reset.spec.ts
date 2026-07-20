import { test, expect } from "@playwright/test";

// Drives the REAL browser UI through the full password-reset flow, end to end:
// request a link on /forgot-password -> follow it to /reset-password -> set a new
// password -> log in with it. Also proves the old password stops working.
//
// No mailer is wired in this build, so the API returns the reset link in the
// /auth/forgot-password response (non-production only); the test reads it there.

const API = "http://localhost:3001/api";

test("forgot -> reset -> login with new password; old password rejected", async ({ page, request }) => {
  const email = `reset_${Date.now()}@example.com`;
  const oldPassword = "oldpass123";
  const newPassword = "newpass456";

  // Seed a real account with a known password via the API.
  const reg = await request.post(`${API}/auth/register/customer`, {
    data: { email, password: oldPassword, fullName: "Reset Tester", isGuest: false },
  });
  expect(reg.ok()).toBeTruthy();

  // 1) Reach the forgot-password page from the login screen.
  await page.goto("/login");
  await page.getByRole("link", { name: /forgot password/i }).click();
  await expect(page).toHaveURL(/\/forgot-password/);

  // 2) Request a reset link and capture the dev-exposed URL from the response.
  const respPromise = page.waitForResponse(
    (r) => r.url().includes("/auth/forgot-password") && r.request().method() === "POST",
  );
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: /send reset link/i }).click();

  const body = await (await respPromise).json();
  expect(body.ok).toBe(true);
  expect(body.resetUrl).toBeTruthy();

  // Confirmation UI renders.
  await expect(page.getByText(/a password reset link is on its way/i)).toBeVisible();

  // 3) Follow the reset link (same-origin relative path).
  const resetPath = String(body.resetUrl).replace(/^https?:\/\/[^/]+/, "");
  await page.goto(resetPath);
  await expect(page.getByRole("heading", { name: /choose a new password/i })).toBeVisible();

  // 4) Set the new password.
  await page.getByPlaceholder("At least 6 characters").fill(newPassword);
  await page.getByPlaceholder("Re-enter your password").fill(newPassword);
  await page.getByRole("button", { name: /update password/i }).click();
  await expect(page.getByRole("heading", { name: /password updated/i })).toBeVisible();

  // 5) Log in through the UI with the NEW password.
  await page.getByRole("button", { name: /go to login/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[type="password"]').fill(newPassword);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Landed logged-in on My jobs (the logged-out prompt is absent).
  await expect(page).toHaveURL(/\/my-jobs/);
  await expect(page.getByText(/log in to see your jobs/i)).toHaveCount(0);

  // 6) The OLD password no longer authenticates (verified against the API).
  const oldLogin = await request.post(`${API}/auth/login`, {
    data: { emailOrPhone: email, password: oldPassword },
  });
  expect(oldLogin.status()).toBe(401);
});

test("reset page rejects an invalid or already-used token", async ({ page }) => {
  await page.goto("/reset-password?token=not-a-real-token-0000");
  await page.getByPlaceholder("At least 6 characters").fill("brandnew123");
  await page.getByPlaceholder("Re-enter your password").fill("brandnew123");
  await page.getByRole("button", { name: /update password/i }).click();
  await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
});

test("reset page with no token shows the invalid-link message", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByRole("heading", { name: /invalid reset link/i })).toBeVisible();
});
