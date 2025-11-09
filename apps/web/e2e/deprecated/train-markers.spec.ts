import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * E2E tests for real-time train markers (Phase B - User Story 1)
 *
 * Tests verify:
 * - Markers appear at train positions on map load
 * - Markers update positions after polling interval
 * - Multiple trains on same line are individually visible
 * - Click handlers work correctly
 *
 * Task: T040 [US1]
 */

/**
 * Mock train positions response for testing
 */
const mockTrainPositions = {
  positions: [
    {
      vehicleKey: 'test-train-1',
      latitude: 41.3851,
      longitude: 2.1734,
      nextStopId: '71801',
      routeId: 'R1',
      status: 'IN_TRANSIT_TO',
      polledAtUtc: new Date().toISOString(),
    },
    {
      vehicleKey: 'test-train-2',
      latitude: 41.4,
      longitude: 2.2,
      nextStopId: '71802',
      routeId: 'R1',
      status: 'IN_TRANSIT_TO',
      polledAtUtc: new Date().toISOString(),
    },
    {
      vehicleKey: 'test-train-3',
      latitude: 41.45,
      longitude: 2.25,
      nextStopId: '71803',
      routeId: 'R2',
      status: 'STOPPED_AT',
      polledAtUtc: new Date().toISOString(),
    },
  ],
  count: 3,
  polledAt: new Date().toISOString(),
};

/**
 * Updated positions for testing marker updates
 */
const updatedTrainPositions = {
  positions: [
    {
      vehicleKey: 'test-train-1',
      latitude: 41.386, // Moved slightly
      longitude: 2.174,
      nextStopId: '71801',
      routeId: 'R1',
      status: 'IN_TRANSIT_TO',
      polledAtUtc: new Date().toISOString(),
    },
    {
      vehicleKey: 'test-train-2',
      latitude: 41.401, // Moved slightly
      longitude: 2.201,
      nextStopId: '71802',
      routeId: 'R1',
      status: 'IN_TRANSIT_TO',
      polledAtUtc: new Date().toISOString(),
    },
    // test-train-3 removed - should disappear
    {
      vehicleKey: 'test-train-4', // New train added
      latitude: 41.5,
      longitude: 2.3,
      nextStopId: '71804',
      routeId: 'R3',
      status: 'IN_TRANSIT_TO',
      polledAtUtc: new Date().toISOString(),
    },
  ],
  count: 3,
  polledAt: new Date().toISOString(),
};

/**
 * Count train markers rendered on the map
 */
async function countTrainMarkers(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const markers = document.querySelectorAll('.train-marker');
    return markers.length;
  });
}

/**
 * Get positions of all train markers
 */
async function getMarkerPositions(page: Page): Promise<Array<{ left: number; top: number }>> {
  return await page.evaluate(() => {
    const markers = document.querySelectorAll('.train-marker');
    return Array.from(markers).map((marker) => {
      const rect = marker.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
      };
    });
  });
}

test.describe('Train markers display and updates', () => {
  test('displays train markers on map load', async ({ page }) => {
    // Mock the API response for train positions
    await page.route('**/api/trains/positions**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockTrainPositions),
      });
    });

    await page.goto('/');

    // Wait for map canvas to be visible
    const mapCanvas = page.getByTestId('map-canvas');
    await expect(mapCanvas, 'map canvas should render').toBeVisible();

    // Wait for markers to appear (wait for at least one marker element)
    await page.waitForSelector('.train-marker', { timeout: 10000 });

    // Give a bit more time for all markers to render
    await page.waitForTimeout(1000);

    // Count markers
    const markerCount = await countTrainMarkers(page);
    expect(markerCount, 'should display all train markers from API').toBe(3);

    // Verify markers have correct styling
    const markerStyles = await page.evaluate(() => {
      const marker = document.querySelector('.train-marker') as HTMLElement;
      if (!marker) return null;
      const styles = window.getComputedStyle(marker);
      return {
        width: styles.width,
        height: styles.height,
        borderRadius: styles.borderRadius,
        backgroundColor: styles.backgroundColor,
        cursor: styles.cursor,
      };
    });

    expect(markerStyles, 'marker should exist with correct styles').not.toBeNull();
    expect(markerStyles?.width, 'marker width should be 12px').toBe('12px');
    expect(markerStyles?.height, 'marker height should be 12px').toBe('12px');
    expect(markerStyles?.borderRadius, 'marker should be circular').toBe('50%');
    expect(markerStyles?.cursor, 'marker should have pointer cursor').toBe('pointer');
  });

  test('updates marker positions on polling interval', async ({ page }) => {
    let requestCount = 0;

    // Mock API to return different positions on second call
    await page.route('**/api/trains/positions**', async (route) => {
      requestCount++;
      if (requestCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockTrainPositions),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(updatedTrainPositions),
        });
      }
    });

    await page.goto('/');

    // Wait for initial markers
    await page.waitForTimeout(2000);
    const initialCount = await countTrainMarkers(page);
    expect(initialCount, 'initial markers should render').toBe(3);

    const initialPositions = await getMarkerPositions(page);

    // Wait for polling interval (30 seconds, but we can trigger it faster in tests)
    // Note: In a real scenario, we'd wait 30s. For testing, markers should update on next poll
    await page.waitForTimeout(31000); // 31 seconds to ensure poll happens

    const updatedCount = await countTrainMarkers(page);
    expect(updatedCount, 'marker count should update (train-3 removed, train-4 added)').toBe(3);

    const updatedPositions = await getMarkerPositions(page);

    // Verify at least one marker changed position
    const positionsChanged = updatedPositions.some((pos, idx) => {
      const initial = initialPositions[idx];
      return initial && (Math.abs(pos.left - initial.left) > 1 || Math.abs(pos.top - initial.top) > 1);
    });

    expect(positionsChanged, 'at least one marker should have moved').toBe(true);
  });

  test('displays multiple trains on same line individually', async ({ page }) => {
    await page.route('**/api/trains/positions**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockTrainPositions),
      });
    });

    await page.goto('/');

    // Wait for markers to appear
    await page.waitForSelector('.train-marker', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Get all marker positions
    const positions = await getMarkerPositions(page);

    // Verify we have 3 markers at different positions
    expect(positions.length, 'should have 3 individual markers').toBe(3);

    // Verify markers are not overlapping (at least 5px apart)
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const distance = Math.sqrt(
          Math.pow(positions[i].left - positions[j].left, 2) +
          Math.pow(positions[i].top - positions[j].top, 2)
        );
        expect(distance, `markers ${i} and ${j} should not overlap`).toBeGreaterThan(5);
      }
    }
  });

  test('logs vehicle key to console on marker click', async ({ page }) => {
    await page.route('**/api/trains/positions**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockTrainPositions),
      });
    });

    // Listen for console.log messages
    const consoleMessages: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'log') {
        consoleMessages.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Click the first marker
    const firstMarker = page.locator('.train-marker').first();
    await expect(firstMarker, 'first marker should be visible').toBeVisible();
    await firstMarker.click();

    // Wait a bit for the console.log
    await page.waitForTimeout(500);

    // Verify console.log was called with vehicle key
    const trainClickLog = consoleMessages.find((msg) => msg.includes('Train clicked:'));
    expect(trainClickLog, 'should log vehicle key on marker click').toBeDefined();
    expect(trainClickLog, 'should include vehicle key in log').toContain('test-train');
  });

  test('handles API errors gracefully', async ({ page }) => {
    // Mock API to return an error
    await page.route('**/api/trains/positions**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Database connection failed' }),
      });
    });

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForTimeout(2000);

    // No markers should render
    const markerCount = await countTrainMarkers(page);
    expect(markerCount, 'no markers should render on API error').toBe(0);

    // Error should be logged to console
    const hasError = consoleErrors.some((msg) => msg.includes('Error fetching train positions'));
    expect(hasError, 'should log error to console').toBe(true);
  });

  test('filters out trains without valid GPS coordinates', async ({ page }) => {
    const positionsWithInvalidCoords = {
      positions: [
        {
          vehicleKey: 'test-train-1',
          latitude: 41.3851,
          longitude: 2.1734,
          nextStopId: '71801',
          routeId: 'R1',
          status: 'IN_TRANSIT_TO',
          polledAtUtc: new Date().toISOString(),
        },
        {
          vehicleKey: 'test-train-invalid',
          latitude: null, // Invalid coordinate
          longitude: null, // Invalid coordinate
          nextStopId: '71802',
          routeId: 'R1',
          status: 'IN_TRANSIT_TO',
          polledAtUtc: new Date().toISOString(),
        },
      ],
      count: 2,
      polledAt: new Date().toISOString(),
    };

    await page.route('**/api/trains/positions**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(positionsWithInvalidCoords),
      });
    });

    await page.goto('/');
    await page.waitForTimeout(2000);

    const markerCount = await countTrainMarkers(page);
    expect(markerCount, 'should only render trains with valid coordinates').toBe(1);
  });
});
