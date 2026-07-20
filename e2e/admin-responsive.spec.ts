import { test, expect } from "@playwright/test";

const API = "http://localhost:3001/api";

// The admin console must be usable on a phone: the sidebar collapses to a hamburger
// drawer and wide tables scroll inside their own box instead of overflowing the page.
test("admin console is usable on a phone viewport", async ({ page, request }) => {
  const admin = await (await request.post(`${API}/auth/login`, { data: { emailOrPhone: "admin@nod.app", password: "admin1234" } })).json();
  await page.addInitScript(
    ([a, r]: [string, string]) => {
      localStorage.setItem("nod_access", a);
      localStorage.setItem("nod_refresh", r);
    },
    [admin.accessToken, admin.refreshToken],
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/providers");
  await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible({ timeout: 15000 });

  // The mobile hamburger is shown (the fixed desktop sidebar is off-canvas).
  const menu = page.getByRole("button", { name: "Open menu" });
  await expect(menu).toBeVisible();

  // The page itself must not scroll horizontally — the wide table scrolls inside its box.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);

  // Opening the drawer reveals the nav; tapping a link navigates and closes it.
  await menu.click();
  const customers = page.getByRole("link", { name: "Customers" });
  await expect(customers).toBeVisible();
  await customers.click();
  await expect(page).toHaveURL(/\/admin\/customers/);
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
});
