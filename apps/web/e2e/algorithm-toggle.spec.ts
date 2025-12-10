/**
 * E2E tests for algorithm toggle UI and persistence
 *
 * Tests:
 * - Toggle visible on map
 * - Click changes mode
 * - Refresh preserves mode
 *
 * Phase 1, Task T006
 */

import { test, expect } from '@playwright/test';

test.describe('Algorithm Toggle', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the map
    await page.goto('/');

    // Wait for map to load
    await page.waitForSelector('[data-testid="map-canvas"]', { timeout: 10000 });
  });

  test('should display algorithm toggle on the map', async ({ page }) => {
    // Toggle should be visible
    const toggle = page.locator('[data-testid="algorithm-toggle"]');
    await expect(toggle).toBeVisible();

    // Both buttons should be visible
    const gpsButton = page.locator('[data-testid="algorithm-toggle-gps"]');
    const predictiveButton = page.locator('[data-testid="algorithm-toggle-predictive"]');

    await expect(gpsButton).toBeVisible();
    await expect(predictiveButton).toBeVisible();
  });

  test('should default to GPS mode', async ({ page }) => {
    const gpsButton = page.locator('[data-testid="algorithm-toggle-gps"]');
    const predictiveButton = page.locator('[data-testid="algorithm-toggle-predictive"]');

    // GPS should be active by default
    await expect(gpsButton).toHaveAttribute('aria-checked', 'true');
    await expect(predictiveButton).toHaveAttribute('aria-checked', 'false');
  });

  test('should switch to predictive mode when clicked', async ({ page }) => {
    const gpsButton = page.locator('[data-testid="algorithm-toggle-gps"]');
    const predictiveButton = page.locator('[data-testid="algorithm-toggle-predictive"]');

    // Click predictive button
    await predictiveButton.click();

    // Predictive should now be active
    await expect(predictiveButton).toHaveAttribute('aria-checked', 'true');
    await expect(gpsButton).toHaveAttribute('aria-checked', 'false');
  });

  test('should switch back to GPS mode', async ({ page }) => {
    const gpsButton = page.locator('[data-testid="algorithm-toggle-gps"]');
    const predictiveButton = page.locator('[data-testid="algorithm-toggle-predictive"]');

    // Switch to predictive
    await predictiveButton.click();
    await expect(predictiveButton).toHaveAttribute('aria-checked', 'true');

    // Switch back to GPS
    await gpsButton.click();
    await expect(gpsButton).toHaveAttribute('aria-checked', 'true');
    await expect(predictiveButton).toHaveAttribute('aria-checked', 'false');
  });

  test('should preserve mode selection after page refresh', async ({ page }) => {
    const predictiveButton = page.locator('[data-testid="algorithm-toggle-predictive"]');

    // Switch to predictive mode
    await predictiveButton.click();
    await expect(predictiveButton).toHaveAttribute('aria-checked', 'true');

    // Reload the page
    await page.reload();

    // Wait for map to load again
    await page.waitForSelector('[data-testid="map-canvas"]', { timeout: 10000 });

    // Mode should still be predictive
    const predictiveButtonAfterReload = page.locator('[data-testid="algorithm-toggle-predictive"]');
    await expect(predictiveButtonAfterReload).toHaveAttribute('aria-checked', 'true');
  });

  test('should be keyboard accessible', async ({ page }) => {
    const predictiveButton = page.locator('[data-testid="algorithm-toggle-predictive"]');

    // Focus predictive button
    await predictiveButton.focus();

    // Press Enter to activate
    await page.keyboard.press('Enter');

    // Predictive should now be active
    await expect(predictiveButton).toHaveAttribute('aria-checked', 'true');
  });

  test('should have proper ARIA attributes', async ({ page }) => {
    const toggle = page.locator('[data-testid="algorithm-toggle"]');
    const gpsButton = page.locator('[data-testid="algorithm-toggle-gps"]');
    const predictiveButton = page.locator('[data-testid="algorithm-toggle-predictive"]');

    // Toggle container should have radiogroup role
    await expect(toggle).toHaveAttribute('role', 'radiogroup');

    // Buttons should have radio role
    await expect(gpsButton).toHaveAttribute('role', 'radio');
    await expect(predictiveButton).toHaveAttribute('role', 'radio');

    // Buttons should have aria-label
    await expect(gpsButton).toHaveAttribute('aria-label');
    await expect(predictiveButton).toHaveAttribute('aria-label');
  });

  test('should have descriptive tooltips', async ({ page }) => {
    const gpsButton = page.locator('[data-testid="algorithm-toggle-gps"]');
    const predictiveButton = page.locator('[data-testid="algorithm-toggle-predictive"]');

    // Buttons should have title attributes for tooltips
    await expect(gpsButton).toHaveAttribute('title');
    await expect(predictiveButton).toHaveAttribute('title');

    // Tooltips should be descriptive
    const gpsTitle = await gpsButton.getAttribute('title');
    const predictiveTitle = await predictiveButton.getAttribute('title');

    expect(gpsTitle).toBeTruthy();
    expect(predictiveTitle).toBeTruthy();
    expect(gpsTitle?.length).toBeGreaterThan(10);
    expect(predictiveTitle?.length).toBeGreaterThan(10);
  });
});
