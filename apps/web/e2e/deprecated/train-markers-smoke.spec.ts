import { expect, test } from '@playwright/test';

/**
 * Smoke test for train markers
 * Tests basic functionality with REAL API data
 * Requires: Go API running on localhost:8081 with database
 */

test.describe('Train markers smoke test (real API)', () => {
  test('displays train markers from real API', async ({ page }) => {
    await page.goto('/');

    // Wait for map canvas
    const mapCanvas = page.getByTestId('map-canvas');
    await expect(mapCanvas).toBeVisible();

    // Wait for train markers to appear (with real API, this might take a moment)
    await page.waitForSelector('.train-marker', { timeout: 15000 });

    // Count how many markers rendered
    const markerCount = await page.evaluate(() => {
      return document.querySelectorAll('.train-marker').length;
    });

    // Just verify we have at least ONE marker
    expect(markerCount, 'should display at least one train marker').toBeGreaterThan(0);

    console.log(`✅ Found ${markerCount} train markers on the map`);
  });

  test('markers are clickable and log to console', async ({ page }) => {
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'log') {
        consoleLogs.push(msg.text());
      }
    });

    await page.goto('/');

    // Wait for markers
    await page.waitForSelector('.train-marker', { timeout: 15000 });

    // Click first marker
    const firstMarker = page.locator('.train-marker').first();
    await firstMarker.click();

    // Wait for console log
    await page.waitForTimeout(500);

    // Verify click was logged
    const hasTrainClick = consoleLogs.some(log => log.includes('Train clicked:'));
    expect(hasTrainClick, 'clicking marker should log to console').toBe(true);
  });

  test('markers have correct styling', async ({ page }) => {
    await page.goto('/');

    // Wait for markers
    await page.waitForSelector('.train-marker', { timeout: 15000 });

    // Check styles
    const styles = await page.evaluate(() => {
      const marker = document.querySelector('.train-marker') as HTMLElement;
      if (!marker) return null;
      const computed = window.getComputedStyle(marker);
      return {
        width: computed.width,
        height: computed.height,
        borderRadius: computed.borderRadius,
        cursor: computed.cursor,
      };
    });

    expect(styles).not.toBeNull();
    expect(styles?.width).toBe('12px');
    expect(styles?.height).toBe('12px');
    expect(styles?.borderRadius).toBe('50%');
    expect(styles?.cursor).toBe('pointer');
  });
});
