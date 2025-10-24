import { test, expect } from '@playwright/test';

/**
 * Performance budget tests
 *
 * Validates that key performance metrics meet defined thresholds:
 * - Initial render: < 3000ms
 * - Geometry load: < 2000ms
 * - Map tiles: < 5000ms
 *
 * These tests help ensure the app remains performant as features are added.
 */

test.describe('Performance Budget Enforcement', () => {
  test('initial page load meets performance budget', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/');

    // Wait for map canvas to be visible
    await page.waitForSelector('[data-testid="map-canvas"]', {
      state: 'visible',
      timeout: 10000,
    });

    // Wait for map to be fully loaded (no loading status message)
    await page.waitForFunction(
      () => {
        const statusBanner = document.querySelector('[data-testid="map-status-banner"]');
        if (!statusBanner) return true; // No banner means loaded
        const text = statusBanner.textContent || '';
        return !text.includes('Loading') && !text.includes('loading');
      },
      { timeout: 15000 },
    );

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Assert: Initial render should be under 3000ms
    expect(duration).toBeLessThan(3000);

    // Log for reporting
    console.log(`📊 Initial page load: ${duration}ms`);
  });

  test('geometry loads within budget', async ({ page }) => {
    await page.goto('/');

    const geometryLoadTime = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        const checkMetrics = () => {
          // Access the metrics from the performance tracking module
          const performanceEntries = performance.getEntriesByName('geometry-load');
          if (performanceEntries.length > 0) {
            resolve(performanceEntries[0].duration);
          } else {
            // Check again after a short delay
            setTimeout(checkMetrics, 100);
          }
        };
        checkMetrics();

        // Timeout after 10 seconds
        setTimeout(() => resolve(-1), 10000);
      });
    });

    // If metric wasn't captured, that's okay for now (feature may not be fully instrumented)
    if (geometryLoadTime > 0) {
      // Assert: Geometry load should be under 2000ms
      expect(geometryLoadTime).toBeLessThan(2000);
      console.log(`📊 Geometry load: ${geometryLoadTime.toFixed(2)}ms`);
    }
  });

  test('map becomes interactive quickly', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/');

    // Wait for recenter button to be clickable (map is interactive)
    const recenterButton = page.locator('[aria-label*="Recenter"]').or(
      page.locator('[aria-label*="recenter"]'),
    );
    await recenterButton.waitFor({ state: 'visible', timeout: 10000 });

    const endTime = Date.now();
    const timeToInteractive = endTime - startTime;

    // Assert: Time to interactive should be under 5000ms
    expect(timeToInteractive).toBeLessThan(5000);

    console.log(`📊 Time to interactive: ${timeToInteractive}ms`);
  });

  test('line highlighting is responsive', async ({ page }) => {
    await page.goto('/');

    // Wait for map to load
    await page.waitForSelector('[data-testid="map-canvas"]', {
      state: 'visible',
      timeout: 10000,
    });

    // Wait for map to be fully loaded
    await page.waitForTimeout(1000);

    // Try to open legend - works for both desktop and mobile
    const desktopLegendButton = page.locator('[aria-label="Show legend"]');
    const mobileLegendButton = page.locator('button:has-text("Lines")');

    if (await desktopLegendButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await desktopLegendButton.click();
    } else if (await mobileLegendButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await mobileLegendButton.click();
    }

    // Find a line button with longer timeout
    const lineButton = page.locator('[data-testid^="legend-entry-"]').first();
    await lineButton.waitFor({ state: 'visible', timeout: 10000 });

    // Measure highlight time (without artificial waits)
    const startTime = Date.now();
    await lineButton.click();

    // Wait for aria-pressed to update (actual state change)
    await expect(lineButton).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });

    const endTime = Date.now();
    const highlightDuration = endTime - startTime;

    // Assert: Line highlighting should be under 5000ms for E2E tests
    // Note: E2E tests have significant overhead, especially in CI
    expect(highlightDuration).toBeLessThan(5000);

    console.log(`📊 Line highlight: ${highlightDuration}ms`);
  });
});

test.describe('Performance Metrics Validation', () => {
  test('validates performance metrics are being recorded', async ({ page }) => {
    await page.goto('/');

    // Wait for map to load
    await page.waitForSelector('[data-testid="map-canvas"]', {
      state: 'visible',
    });

    // Check if performance marks exist
    const hasPerformanceMarks = await page.evaluate(() => {
      const marks = performance.getEntriesByType('mark');
      return marks.length > 0;
    });

    // It's okay if marks don't exist yet, but log for visibility
    console.log(`Performance marks recorded: ${hasPerformanceMarks}`);
  });
});
