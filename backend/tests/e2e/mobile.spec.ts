import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("mobile: menu navigation and no horizontal scroll", async ({ page }) => {
  await signUp(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Sources" }).click();
  await expect(page).toHaveURL(/\/sources/);
});
