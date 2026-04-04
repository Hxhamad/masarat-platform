import { test, expect } from '@playwright/test';

test('app loads and shows FIR selection modal', async ({ page }) => {
  await page.goto('/');
  // The FIR selection modal should appear on first load (no saved FIRs)
  await expect(page.locator('.fir-modal')).toBeVisible({ timeout: 10_000 });
});

test('sidebar panel is present in docked layout', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.adsb-panel')).toBeVisible({ timeout: 10_000 });
});

test('map container renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 });
});

test('layer control shows weather and GNSS overlay selections', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.leaflet-control-layers')).toContainText('Weather (Open-Meteo)', { timeout: 10_000 });
  await expect(page.locator('.leaflet-control-layers')).toContainText('GNSS Jamming (ADS-B inferred)');
});

test('header has sidebar toggle button', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.header__btn').first()).toBeVisible({ timeout: 10_000 });
});
