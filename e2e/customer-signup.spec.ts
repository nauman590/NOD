import { test, expect } from "@playwright/test";

const API = "http://localhost:3001/api";
const uniq = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

// The dedicated customer signup page creates an account and lands the user in My Jobs,
// and the resulting account is a real, loginable customer.
test("customer can create an account from the signup page", async ({ page, request }) => {
  const email = `signup_${uniq()}@nod.app`;

  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();

  await page.getByPlaceholder("Jane Doe").fill("Signup Tester");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("Create a password").fill("secret123");
  await page.getByRole("button", { name: "Create account" }).click();

  // Lands in My Jobs as the new customer.
  await expect(page).toHaveURL(/\/my-jobs/, { timeout: 15000 });

  // The account is real and loginable.
  const login = await request.post(`${API}/auth/login`, { data: { emailOrPhone: email, password: "secret123" } });
  expect(login.ok()).toBeTruthy();
  const body = await login.json();
  expect(body.user.role).toBe("CUSTOMER");
  expect(body.user.fullName).toBe("Signup Tester");
});
