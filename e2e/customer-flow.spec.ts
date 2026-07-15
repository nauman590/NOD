import { test, expect } from "@playwright/test";
import path from "path";

const FIXTURE = path.join(__dirname, "fixture.png");

// Drives the REAL browser UI: the bug was "request entity too large" on /estimate
// because the photo went through JSON. These tests prove upload + estimate work.

test("junk flow: upload photo + single address -> estimate shows a price", async ({ page }) => {
  await page.goto("/");

  // upload a photo (hidden file input) and wait for the upload to finish
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByText("Uploading…")).toHaveCount(0, { timeout: 15000 });

  // pick category, fill details
  await page.selectOption("select", "junk");
  await page.getByPlaceholder(/Old sofa and two boxes/).fill("Old sofa, two boxes and a broken desk in the garage, second floor walk-up");

  // single service address appears for junk
  await page.getByPlaceholder("123 Peachtree St, Atlanta, GA").fill("500 Peachtree St NE, Atlanta, GA");

  // continue
  await page.getByRole("button", { name: /See my price/i }).click();

  // estimate page: a price renders, and the error does NOT
  await expect(page).toHaveURL(/\/estimate/);
  await expect(page.getByText("Couldn't price this task")).toHaveCount(0);
  await expect(page.getByText("AI estimated price")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Price locked for/)).toBeVisible();
  // a dollar amount is shown
  await expect(page.locator("text=/\\$\\d+/").first()).toBeVisible();
});

test("delivery flow: pickup + dropoff fields appear and estimate works", async ({ page }) => {
  await page.goto("/");

  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByText("Uploading…")).toHaveCount(0, { timeout: 15000 });

  await page.selectOption("select", "delivery");
  await page.getByPlaceholder(/Old sofa and two boxes/).fill("Pick up a dresser from the store and deliver to my apartment");

  // delivery asks for BOTH pickup and drop-off
  await expect(page.getByPlaceholder("Store or pickup location")).toBeVisible();
  await page.getByPlaceholder("Store or pickup location").fill("Home Depot, 650 Ponce De Leon Ave, Atlanta, GA");
  await page.getByPlaceholder("123 Peachtree St, Atlanta, GA").fill("1280 W Peachtree St NW, Atlanta, GA");

  await page.getByRole("button", { name: /See my price/i }).click();

  await expect(page).toHaveURL(/\/estimate/);
  await expect(page.getByText("Couldn't price this task")).toHaveCount(0);
  await expect(page.getByText("AI estimated price")).toBeVisible({ timeout: 15000 });
});

test("full purchase: home -> estimate -> checkout -> job tracking", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByText("Uploading…")).toHaveCount(0, { timeout: 15000 });
  await page.selectOption("select", "handyman");
  await page.getByPlaceholder(/Old sofa and two boxes/).fill("Mount a 55-inch TV on drywall and hide the cables");
  await page.getByPlaceholder("123 Peachtree St, Atlanta, GA").fill("22 Edgewood Ave NE, Atlanta, GA");
  await page.getByRole("button", { name: /See my price/i }).click();

  await expect(page.getByText("AI estimated price")).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /Confirm and pay/i }).click();

  // checkout: address carried over, create an account, fill name + real Stripe card, pay
  await expect(page).toHaveURL(/\/checkout/);
  await expect(page.getByText("22 Edgewood Ave NE, Atlanta, GA")).toBeVisible();
  await page.getByPlaceholder("you@example.com").fill(`buyer_${Date.now()}@example.com`);
  await page.getByPlaceholder("Create a password").fill("secret123");
  await page.getByPlaceholder("Jane Doe").fill("Test Customer");
  const cardFrame = page.frameLocator('iframe[title="Secure card payment input frame"]');
  await cardFrame.locator('[name="cardnumber"]').fill("4242 4242 4242 4242");
  await cardFrame.locator('[name="exp-date"]').fill("12 / 34");
  await cardFrame.locator('[name="cvc"]').fill("123");
  await cardFrame.locator('[name="postal"]').fill("30303");
  await page.getByRole("button", { name: /Pay now/i }).click();

  // success modal -> OK -> job tracking
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page).toHaveURL(/\/job\//, { timeout: 15000 });
  await expect(page.getByText("Finding a pro")).toBeVisible();
});
