import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("redirects signed-out visitors to sign-in and back", async ({ page }) => {
  await page.goto("/dashboard?range=30d");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard%3Frange%3D30d/);
});

test("sign up → simulated data → live dashboard → sign out", async ({ page }) => {
  await signUp(page);
  await expect(page.getByRole("heading", { name: "Connect a data source" })).toBeVisible();

  await page.getByRole("link", { name: "Go to Sources" }).click();
  await page.getByRole("button", { name: "Enable simulated data" }).click();
  await expect(page.getByText(/Simulated source connected/)).toBeVisible();

  // The worker backfills 30 days; the card's freshness updates over SSE.
  const mockCard = page.locator("[data-slot=card]", { hasText: "Simulated data" });
  await expect(mockCard.getByText("Latest data")).toBeVisible();
  await expect(mockCard.getByText(/just now|min ago/).first()).toBeVisible({ timeout: 60_000 });

  await page.getByRole("link", { name: "Dashboard" }).first().click();
  await expect(page.getByText("Includes simulated data")).toBeVisible();
  await expect(page.getByRole("list", { name: "Key metrics" })).toContainText("Resting HR");
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
  await expect(page.locator("header [aria-live]")).toHaveText("Live");

  // Range filter lives in the URL; the table view mirrors the chart.
  await page.getByRole("button", { name: "30D" }).click();
  await expect(page).toHaveURL(/range=30d/);
  const steps = page.locator("[data-slot=card]", { hasText: "Daily average" }).first();
  await steps.getByRole("tab", { name: "Table" }).click();
  await expect(steps.getByRole("table")).toBeVisible();

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});

test("Live page explains Bluetooth and accepts readings", async ({ page }) => {
  await signUp(page);
  await page.goto("/live");
  await expect(page.getByRole("button", { name: /Connect watch/ })).toBeVisible();
  const res = await page.request.post("/api/ingest/ble", {
    data: { samples: [{ ts: Date.now() - 1000, bpm: 99 }] },
  });
  expect(res.status()).toBe(200);
  await expect(
    page.locator("[data-slot=card]", { hasText: "Today, all sources" }).locator(".recharts-surface"),
  ).toBeVisible();
});

test("security headers are set", async ({ request }) => {
  const res = await request.get("/sign-in");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["permissions-policy"]).toContain("bluetooth=(self)");
});
