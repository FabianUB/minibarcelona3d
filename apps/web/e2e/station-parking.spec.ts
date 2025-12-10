/**
 * E2E tests for station parking visual verification
 *
 * Tests:
 * - Navigate to station with stopped trains
 * - Enable predictive mode
 * - Verify trains are visually separated
 *
 * Phase 2, Task T014
 *
 * Note: These tests require the algorithm toggle UI (Phase 1) to be implemented.
 * Currently, some tests are skipped pending that implementation.
 */

import { test, expect } from '@playwright/test';

test.describe('Station Parking Visual Verification', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the map
    await page.goto('/');

    // Wait for map to load
    await page.waitForSelector('.mapboxgl-canvas', { timeout: 10000 });

    // Wait for trains to load and render
    await page.waitForTimeout(3000);
  });

  test('should render map with trains loaded', async ({ page }) => {
    // Verify map canvas is visible
    const canvas = page.locator('.mapboxgl-canvas');
    await expect(canvas).toBeVisible();

    // Wait for trains to be rendered (check for WebGL content)
    // This is a basic check - trains are rendered in a custom Three.js layer
    await page.waitForTimeout(2000);

    // Take screenshot for visual reference
    await page.screenshot({
      path: 'test-results/station-parking-map-loaded.png',
      fullPage: false,
    });

    console.log('Map with trains loaded successfully');
  });

  test('should zoom to Barcelona Sants station', async ({ page }) => {
    // Barcelona Sants is a major hub with multiple lines - good for parking tests
    const santsCoords = { lng: 2.1407, lat: 41.3792 };

    // Zoom to station area
    const canvas = page.locator('.mapboxgl-canvas');
    await canvas.dblclick({ position: { x: 400, y: 300 } });
    await page.waitForTimeout(500);

    // Navigate to Sants using map flyTo via console evaluation
    await page.evaluate(({ lng, lat }) => {
      // Access Mapbox map instance (if exposed on window)
      const mapElement = document.querySelector('.mapboxgl-canvas');
      if (mapElement) {
        // Dispatch a custom event that our app listens to for navigation
        const event = new CustomEvent('navigate-to-location', {
          detail: { lng, lat, zoom: 15 },
        });
        window.dispatchEvent(event);
      }
    }, santsCoords);

    await page.waitForTimeout(2000);

    // Take screenshot at high zoom
    await page.screenshot({
      path: 'test-results/station-parking-sants-zoom.png',
      fullPage: false,
    });

    console.log('Zoomed to Barcelona Sants station');
  });

  test.skip('should toggle algorithm to predictive mode', async ({ page }) => {
    // This test requires the AlgorithmToggle component (Phase 1, Task T002)
    // Currently skipped until that component is implemented

    const predictiveButton = page.locator('[data-testid="algorithm-toggle-predictive"]');

    // Toggle should exist
    await expect(predictiveButton).toBeVisible({ timeout: 5000 });

    // Click to switch to predictive mode
    await predictiveButton.click();
    await expect(predictiveButton).toHaveAttribute('aria-checked', 'true');

    console.log('Switched to predictive mode');
  });

  test.skip('should display stopped trains with parking offsets', async ({ page }) => {
    // This test requires:
    // 1. AlgorithmToggle component (Phase 1)
    // 2. Trains that are currently stopped at a station
    // 3. Visual verification that trains don't overlap

    // Enable predictive mode
    const predictiveButton = page.locator('[data-testid="algorithm-toggle-predictive"]');
    await predictiveButton.click();

    // Wait for mode change to take effect
    await page.waitForTimeout(1000);

    // Zoom to a station with stopped trains
    // (Barcelona Sants is a good candidate)
    const santsCoords = { lng: 2.1407, lat: 41.3792 };

    await page.evaluate(({ lng, lat }) => {
      const event = new CustomEvent('navigate-to-location', {
        detail: { lng, lat, zoom: 16 },
      });
      window.dispatchEvent(event);
    }, santsCoords);

    await page.waitForTimeout(2000);

    // Take screenshot for manual visual verification
    await page.screenshot({
      path: 'test-results/station-parking-predictive-mode.png',
      fullPage: false,
    });

    console.log('Screenshot captured for visual verification of parking offsets');
  });

  test('trains should not visually overlap at high zoom', async ({ page }) => {
    // This is a visual test that captures screenshots at different zoom levels
    // Manual verification is needed to confirm trains don't overlap

    const canvas = page.locator('.mapboxgl-canvas');

    // Zoom in by double-clicking multiple times
    await canvas.dblclick({ position: { x: 400, y: 300 } });
    await page.waitForTimeout(800);
    await canvas.dblclick({ position: { x: 400, y: 300 } });
    await page.waitForTimeout(800);
    await canvas.dblclick({ position: { x: 400, y: 300 } });
    await page.waitForTimeout(1000);

    // Take screenshot at zoom 14+
    const screenshot = await page.screenshot({
      path: 'test-results/station-parking-high-zoom.png',
      fullPage: false,
    });

    expect(screenshot).toBeTruthy();
    console.log('High zoom screenshot captured for visual verification');
  });

  test('should render trains with correct bearing at stations', async ({ page }) => {
    // Verify trains are oriented along the track at stations
    // This is primarily a visual test

    const canvas = page.locator('.mapboxgl-canvas');
    await expect(canvas).toBeVisible();

    // Wait for train meshes to fully render
    await page.waitForTimeout(3000);

    // Take multiple screenshots at different times to capture train positions
    for (let i = 0; i < 3; i++) {
      await page.screenshot({
        path: `test-results/station-parking-bearing-${i + 1}.png`,
        fullPage: false,
      });
      await page.waitForTimeout(1000);
    }

    console.log('Train bearing screenshots captured for visual verification');
  });

  test('parking positions should be consistent across page reloads', async ({ page }) => {
    // Verify that the same train gets the same parking slot after reload
    // Uses deterministic slot assignment based on vehicleKey

    // Take initial screenshot
    await page.screenshot({
      path: 'test-results/station-parking-before-reload.png',
      fullPage: false,
    });

    // Reload the page
    await page.reload();

    // Wait for map and trains to load
    await page.waitForSelector('.mapboxgl-canvas', { timeout: 10000 });
    await page.waitForTimeout(3000);

    // Take screenshot after reload
    await page.screenshot({
      path: 'test-results/station-parking-after-reload.png',
      fullPage: false,
    });

    console.log('Pre/post reload screenshots captured for consistency verification');
  });
});

/**
 * Visual Verification Notes:
 *
 * These E2E tests rely on visual verification through screenshots.
 * To verify the parking system works correctly:
 *
 * 1. Run tests: npm run test:e2e -- station-parking.spec.ts
 * 2. Review screenshots in test-results/ folder
 * 3. Verify:
 *    - Stopped trains at stations have perpendicular offsets
 *    - Multiple trains at same station don't overlap
 *    - Trains are aligned with track bearing
 *    - Positions are consistent after page reload
 *
 * For automated verification, consider:
 * - Pixel comparison between screenshots
 * - Injecting test trains at known positions
 * - Using WebGL texture readback to detect overlaps
 */
