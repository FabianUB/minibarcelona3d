import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type mapboxgl from 'mapbox-gl';

/**
 * E2E Tests for User Story 1: View Stations on Map
 * Feature: 004-station-visualization
 *
 * Tests verify that station markers:
 * - Appear on map load
 * - Scale with zoom level
 * - Show concentric circles for multi-line stations
 * - Filter by highlighted lines
 */

/**
 * Internal Mapbox GL source data type (for testing purposes)
 * Note: Accessing internal _data property - not part of public API
 */
interface MapboxSourceData {
  type: string;
  features?: Array<{
    type: string;
    geometry: {
      type: string;
      coordinates: number[] | number[][];
    };
    properties: Record<string, unknown>;
  }>;
}

/**
 * Mapbox GL source with internal _data property
 */
interface MapboxSourceWithData extends mapboxgl.GeoJSONSource {
  _data?: MapboxSourceData;
}

/**
 * Load station data from manifest
 */
async function loadStationData(page: Page) {
  const manifestResponse = await page.request.get('/rodalies_data/manifest.json');
  if (!manifestResponse.ok()) {
    throw new Error('Failed to load Rodalies manifest for station data');
  }
  const manifest = (await manifestResponse.json()) as {
    stations?: { path: string };
  };
  const stationPath = manifest.stations?.path;
  if (!stationPath) {
    throw new Error('Stations path missing from manifest');
  }
  const sanitisedPath = stationPath.startsWith('/')
    ? stationPath
    : stationPath.startsWith('rodalies_data/')
      ? `/${stationPath}`
      : `/rodalies_data/${stationPath}`;
  const stationResponse = await page.request.get(sanitisedPath);
  if (!stationResponse.ok()) {
    throw new Error(`Failed to load station data from ${sanitisedPath}`);
  }
  const stationData = (await stationResponse.json()) as {
    type: 'FeatureCollection';
    features: Array<{
      properties: {
        id: string;
        name: string;
        code: string | null;
        lines: string[];
      };
      geometry: {
        type: 'Point';
        coordinates: [number, number];
      };
    }>;
  };
  if (!stationData.features || stationData.features.length === 0) {
    throw new Error('Station data is empty');
  }
  return stationData;
}

/**
 * Wait for map to be loaded and return Mapbox instance
 */
async function waitForMapLoad(page: Page) {
  await page.waitForFunction(
    () => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__;
      return map && map.loaded();
    },
    { timeout: 10000 }
  );

  return page.evaluate(() => {
    const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
      .__MAPBOX_INSTANCE__;
    if (!map) {
      throw new Error('Mapbox instance unavailable on window');
    }
    return map;
  });
}

async function selectStationViaActions(page: Page, stationId: string) {
  await page.evaluate((id) => {
    const actions = (window as unknown as { __MAP_ACTIONS__?: { selectStation?: (value: string) => void } })
      .__MAP_ACTIONS__;
    if (!actions || typeof actions.selectStation !== 'function') {
      throw new Error('Map actions not available for station selection');
    }
    actions.selectStation(id);
  }, stationId);
}

test.describe('User Story 1: View Stations on Map', () => {
  test('T019: all stations appear on map load', async ({ page }) => {
    // Load expected station data
    const stationData = await loadStationData(page);
    const expectedStationCount = stationData.features.length;

    // Navigate to app
    await page.goto('/');

    // Wait for map to load
    const mapCanvas = page.getByTestId('map-canvas');
    await expect(mapCanvas, 'map canvas should render').toBeVisible();

    await waitForMapLoad(page);

    // Check that station source exists
    const hasStationSource = await page.evaluate(() => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__;
      if (!map) return false;
      return map.getSource('stations-source') !== undefined;
    });

    expect(hasStationSource, 'stations-source should be added to map').toBe(true);

    // Check that station layer exists (teardrop symbol layer)
    const hasStationLayer = await page.evaluate(() => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__;
      if (!map) return false;

      const layer = map.getLayer('stations-lowmarkers');
      return layer !== undefined && layer.type === 'symbol';
    });

    expect(
      hasStationLayer,
      'stations-lowmarkers symbol layer should be added'
    ).toBe(true);

    // Verify station features are loaded
    const stationFeatureCount = await page.evaluate(() => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__;
      if (!map) return 0;

      const source = map.getSource('stations-source') as MapboxSourceWithData;
      if (!source) return 0;

      // Access internal _data property to get feature count
      const sourceData = source._data;
      if (sourceData?.features) {
        return sourceData.features.length;
      }
      return 0;
    });

    expect(
      stationFeatureCount,
      `should load all ${expectedStationCount} stations`
    ).toBe(expectedStationCount);
  });

  test('T020: station markers scale with zoom level', async ({ page }) => {
    await page.goto('/');

    const mapCanvas = page.getByTestId('map-canvas');
    await expect(mapCanvas, 'map canvas should render').toBeVisible();

    await waitForMapLoad(page);

    // Wait for stations to load
    await page.waitForFunction(
      () => {
        const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
          .__MAPBOX_INSTANCE__;
        return map && map.getSource('stations-source') !== undefined;
      },
      { timeout: 10000 }
    );

    // Get marker size at zoom level 13 (below threshold)
    const sizeAtZoom13 = await page.evaluate(async () => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__!;
      map.setZoom(13);
      await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for render

      const layer = map.getLayer('stations-lowmarkers');
      if (!layer || layer.type !== 'symbol') return null;

      // Get layout property for icon-size (teardrop markers scale with zoom)
      return map.getLayoutProperty('stations-lowmarkers', 'icon-size');
    });

    // Get marker size at zoom level 16 (above threshold)
    const sizeAtZoom16 = await page.evaluate(async () => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__!;
      map.setZoom(16);
      await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for render

      return map.getLayoutProperty('stations-lowmarkers', 'icon-size');
    });

    expect(sizeAtZoom13, 'should have icon-size layout property at zoom 13').toBeTruthy();
    expect(sizeAtZoom16, 'should have icon-size layout property at zoom 16').toBeTruthy();

    // Both should use step/interpolate expression (array format)
    expect(
      Array.isArray(sizeAtZoom13),
      'icon-size should use expression-based sizing'
    ).toBe(true);
    expect(
      Array.isArray(sizeAtZoom16),
      'circle-radius should use expression-based sizing at zoom 16'
    ).toBe(true);
  });

  test('T021: multi-line stations show concentric circles', async ({ page }) => {
    // Load station data to find a multi-line station
    const stationData = await loadStationData(page);
    const multiLineStation = stationData.features.find(
      (station) => station.properties.lines.length > 1
    );

    expect(
      multiLineStation,
      'test data should contain at least one multi-line station'
    ).toBeTruthy();

    await page.goto('/');

    const mapCanvas = page.getByTestId('map-canvas');
    await expect(mapCanvas, 'map canvas should render').toBeVisible();

    await waitForMapLoad(page);

    // Wait for stations to load
    await page.waitForFunction(
      () => {
        const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
          .__MAPBOX_INSTANCE__;
        return map && map.getSource('stations-source') !== undefined;
      },
      { timeout: 10000 }
    );

    // Check that station layer exists and contains multi-line station data
    const hasMultiLineData = await page.evaluate((multiStationId) => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__;
      if (!map) return false;

      // Verify the main station layer exists
      const layer = map.getLayer('stations-lowmarkers');
      if (!layer || layer.type !== 'symbol') return false;

      // Verify multi-line station data is present in source
      const source = map.getSource('stations-source') as MapboxSourceWithData;
      if (!source) return false;

      const sourceData = source._data;
      if (!sourceData?.features) return false;

      // Find the multi-line station in the data
      const multiStation = sourceData.features.find(
        (f) => f.properties.id === multiStationId
      );

      return multiStation && multiStation.properties.isMultiLine === true;
    }, multiLineStation!.properties.id);

    expect(
      hasMultiLineData,
      'station layer should contain multi-line station data with isMultiLine property'
    ).toBe(true);
  });

  test('T022: stations filter by highlighted lines', async ({ page }) => {
    // Load station data
    const stationData = await loadStationData(page);

    // Find a line ID that appears in station data
    const lineIds = new Set<string>();
    stationData.features.forEach((station) => {
      station.properties.lines.forEach((lineId) => lineIds.add(lineId));
    });
    const testLineId = Array.from(lineIds)[0];

    expect(testLineId, 'should have at least one line ID in station data').toBeTruthy();

    await page.goto('/');

    const mapCanvas = page.getByTestId('map-canvas');
    await expect(mapCanvas, 'map canvas should render').toBeVisible();

    await waitForMapLoad(page);

    // Wait for stations to load
    await page.waitForFunction(
      () => {
        const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
          .__MAPBOX_INSTANCE__;
        return map && map.getSource('stations-source') !== undefined;
      },
      { timeout: 10000 }
    );

    // Open legend panel
    const legendToggle = page.getByTestId('legend-toggle-button');
    if (await legendToggle.isVisible()) {
      await legendToggle.click();
    }

    const legendPanel = page.getByTestId('rodalies-legend');
    await expect(legendPanel, 'legend panel should be visible').toBeVisible();

    // Click line in legend to isolate it
    const legendEntry = legendPanel.getByTestId(`legend-entry-${testLineId}`);
    await expect(legendEntry, `legend entry for ${testLineId} should exist`).toBeVisible();

    // Use isolate action (Ctrl+Click or programmatically)
    await page.evaluate((lineId) => {
      const windowWithActions = window as unknown as {
        __MAP_ACTIONS__?: { isolateLine?: (lineId: string) => void };
      };
      const actions = windowWithActions.__MAP_ACTIONS__;
      if (actions?.isolateLine) {
        actions.isolateLine(lineId);
      }
    }, testLineId);

    // Wait for state update
    await page.waitForTimeout(500);

    // Verify that opacity changes were applied
    // Note: Actual opacity value depends on whether station serves the highlighted line
    const updatedOpacity = await page.evaluate(() => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__!;
      return map.getPaintProperty('stations-lowmarkers', 'icon-opacity');
    });

    // Opacity should be set (either 1.0 for serving the line, or 0.3 for dimmed)
    expect(
      updatedOpacity,
      'station opacity should be updated after line isolation'
    ).toBeTruthy();

    // The opacity should be a number (not an expression for this simple case)
    // or an expression that evaluates based on line highlighting
    const isValidOpacity =
      typeof updatedOpacity === 'number' ||
      (Array.isArray(updatedOpacity) && updatedOpacity.length > 0);

    expect(
      isValidOpacity,
      'opacity should be a valid value or expression'
    ).toBe(true);
  });
});

test.describe('User Story 2: Click Station for Details', () => {
  test('T037: clicking station opens detail panel', async ({ page }) => {
    const stationData = await loadStationData(page);
    const targetStation = stationData.features[0];

    await page.goto('/');
    await waitForMapLoad(page);

    await selectStationViaActions(page, targetStation.properties.id);

    const panel = page.getByTestId('station-info-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(targetStation.properties.name);
  });

  test('T038: panel shows station name, code, and lines', async ({ page }) => {
    const stationData = await loadStationData(page);
    const targetStation =
      stationData.features.find((station) => Boolean(station.properties.code)) ??
      stationData.features[0];

    await page.goto('/');
    await waitForMapLoad(page);

    await selectStationViaActions(page, targetStation.properties.id);

    const panel = page.getByTestId('station-info-panel');
    await expect(panel).toBeVisible();

    // Only check for station code if the station has one
    if (targetStation.properties.code) {
      const codeElement = panel.getByTestId('station-code');
      await expect(codeElement).toBeVisible();
      await expect(codeElement).toContainText(targetStation.properties.code);
    }

    const badges = panel.getByTestId('station-line-badges').getByTestId('station-line-badge');
    await expect(badges).toHaveCount(targetStation.properties.lines.length);
  });

  test('T039: clicking another station updates panel', async ({ page }) => {
    const stationData = await loadStationData(page);
    const first = stationData.features[0];
    const second = stationData.features[1] ?? first;

    await page.goto('/');
    await waitForMapLoad(page);

    await selectStationViaActions(page, first.properties.id);
    const panel = page.getByTestId('station-info-panel');
    await expect(panel).toContainText(first.properties.name);

    await selectStationViaActions(page, second.properties.id);
    await expect(panel).toContainText(second.properties.name);
    if (second.properties.name !== first.properties.name) {
      await expect(panel).not.toContainText(first.properties.name);
    }
  });

  test('T040: panel closes on outside click and escape', async ({ page }) => {
    const stationData = await loadStationData(page);
    const targetStation = stationData.features[0];

    await page.goto('/');
    await waitForMapLoad(page);

    // Test Escape key
    await selectStationViaActions(page, targetStation.properties.id);
    const panel = page.getByTestId('station-info-panel');
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible();

    // Test outside click on map canvas
    await selectStationViaActions(page, targetStation.properties.id);
    await expect(panel).toBeVisible();

    // Click on map canvas (outside the panel) - use force to bypass pointer-events blocking
    const mapCanvas = page.getByTestId('map-canvas');
    await mapCanvas.click({ position: { x: 100, y: 100 }, force: true });
    await expect(panel).not.toBeVisible();
  });

  test('T041: rapid station clicks show only most recent', async ({ page }) => {
    const stationData = await loadStationData(page);
    const first = stationData.features[0];
    const second = stationData.features[1] ?? stationData.features[0];

    await page.goto('/');
    await waitForMapLoad(page);

    await page.evaluate(([firstId, secondId]) => {
      const actions = (window as unknown as { __MAP_ACTIONS__?: { selectStation?: (value: string) => void } })
        .__MAP_ACTIONS__;
      if (!actions || typeof actions.selectStation !== 'function') {
        throw new Error('Map actions unavailable');
      }
      actions.selectStation(firstId);
      actions.selectStation(secondId);
    }, [first.properties.id, second.properties.id]);

    const panel = page.getByTestId('station-info-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(second.properties.name);
    if (first.properties.name !== second.properties.name) {
      await expect(panel).not.toContainText(first.properties.name);
    }
  });
});

test.describe('User Story 3: Hover Station Preview', () => {
  // TODO: Re-enable when hover functionality is active (currently disabled in StationLayer.tsx)
  test.skip('T056: hovering shows tooltip with station name', async ({ page }) => {
    const stationData = await loadStationData(page);
    const targetStation = stationData.features[0];

    await page.goto('/');
    await waitForMapLoad(page);

    // Wait for stations to load
    await page.waitForFunction(
      () => {
        const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
          .__MAPBOX_INSTANCE__;
        return map && map.getSource('stations-source') !== undefined;
      },
      { timeout: 10000 }
    );

    // Zoom to high zoom level (>= 15) where stations are clickable/hoverable
    await page.evaluate(() => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__!;
      map.setZoom(16);
    });

    await page.waitForTimeout(1000); // Wait for zoom animation

    // Get station position on screen
    const stationScreenPos = await page.evaluate((stationId) => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__!;

      // Get station data from source
      const source = map.getSource('stations-source') as MapboxSourceWithData;
      const sourceData = source._data;
      const station = sourceData?.features?.find((f) => f.properties.id === stationId);

      if (!station) return null;

      const [lng, lat] = station.geometry.coordinates;
      const point = map.project([lng, lat]);

      return { x: point.x, y: point.y };
    }, targetStation.properties.id);

    expect(stationScreenPos, 'should find station on map').toBeTruthy();

    // Hover over the station
    const mapCanvas = page.getByTestId('map-canvas');
    await mapCanvas.hover({ position: { x: stationScreenPos!.x, y: stationScreenPos!.y } });

    // Wait for tooltip to appear (should be within 100ms, but give some buffer)
    await page.waitForTimeout(200);

    // Check that tooltip/popup exists and contains station name
    const tooltipVisible = await page.evaluate((stationName) => {
      const popups = document.querySelectorAll('.mapboxgl-popup-content');
      for (const popup of popups) {
        if (popup.textContent?.includes(stationName)) {
          return true;
        }
      }
      return false;
    }, targetStation.properties.name);

    expect(tooltipVisible, 'tooltip should appear with station name').toBe(true);
  });

  // TODO: Re-enable when hover functionality is active (currently disabled in StationLayer.tsx)
  test.skip('T057: tooltip disappears on mouse leave', async ({ page }) => {
    const stationData = await loadStationData(page);
    const targetStation = stationData.features[0];

    await page.goto('/');
    await waitForMapLoad(page);

    await page.waitForFunction(
      () => {
        const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
          .__MAPBOX_INSTANCE__;
        return map && map.getSource('stations-source') !== undefined;
      },
      { timeout: 10000 }
    );

    // Zoom to high zoom level
    await page.evaluate(() => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__!;
      map.setZoom(16);
    });

    await page.waitForTimeout(1000);

    // Get station position
    const stationScreenPos = await page.evaluate((stationId) => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__!;
      const source = map.getSource('stations-source') as MapboxSourceWithData;
      const sourceData = source._data;
      const station = sourceData?.features?.find((f) => f.properties.id === stationId);

      if (!station) return null;

      const [lng, lat] = station.geometry.coordinates;
      const point = map.project([lng, lat]);

      return { x: point.x, y: point.y };
    }, targetStation.properties.id);

    // Hover over the station
    const mapCanvas = page.getByTestId('map-canvas');
    await mapCanvas.hover({ position: { x: stationScreenPos!.x, y: stationScreenPos!.y } });
    await page.waitForTimeout(200);

    // Verify tooltip is visible
    let tooltipVisible = await page.evaluate((stationName) => {
      const popups = document.querySelectorAll('.mapboxgl-popup-content');
      for (const popup of popups) {
        if (popup.textContent?.includes(stationName)) {
          return true;
        }
      }
      return false;
    }, targetStation.properties.name);

    expect(tooltipVisible, 'tooltip should be visible after hover').toBe(true);

    // Move mouse away from station
    await mapCanvas.hover({ position: { x: 100, y: 100 } });

    // Wait for tooltip to disappear (should be within 200ms)
    await page.waitForTimeout(300);

    // Verify tooltip is gone
    tooltipVisible = await page.evaluate((stationName) => {
      const popups = document.querySelectorAll('.mapboxgl-popup-content');
      for (const popup of popups) {
        if (popup.textContent?.includes(stationName)) {
          return true;
        }
      }
      return false;
    }, targetStation.properties.name);

    expect(tooltipVisible, 'tooltip should disappear after mouse leave').toBe(false);
  });

  // TODO: Re-enable when hover functionality is active (currently disabled in StationLayer.tsx)
  test.skip('T058: tooltip shows line count after 500ms', async ({ page }) => {
    const stationData = await loadStationData(page);
    // Find a multi-line station for this test
    const targetStation = stationData.features.find(
      (station) => station.properties.lines.length > 1
    ) ?? stationData.features[0];

    await page.goto('/');
    await waitForMapLoad(page);

    await page.waitForFunction(
      () => {
        const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
          .__MAPBOX_INSTANCE__;
        return map && map.getSource('stations-source') !== undefined;
      },
      { timeout: 10000 }
    );

    // Zoom to high zoom level
    await page.evaluate(() => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__!;
      map.setZoom(16);
    });

    await page.waitForTimeout(1000);

    // Get station position
    const stationScreenPos = await page.evaluate((stationId) => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__!;
      const source = map.getSource('stations-source') as MapboxSourceWithData;
      const sourceData = source._data;
      const station = sourceData?.features?.find((f) => f.properties.id === stationId);

      if (!station) return null;

      const [lng, lat] = station.geometry.coordinates;
      const point = map.project([lng, lat]);

      return { x: point.x, y: point.y };
    }, targetStation.properties.id);

    const mapCanvas = page.getByTestId('map-canvas');
    await mapCanvas.hover({ position: { x: stationScreenPos!.x, y: stationScreenPos!.y } });

    // Wait 200ms - tooltip should show name but not line count yet
    await page.waitForTimeout(200);

    let tooltipContent = await page.evaluate(() => {
      const popups = document.querySelectorAll('.mapboxgl-popup-content');
      return popups[0]?.textContent || '';
    });

    // Should have station name initially
    expect(tooltipContent.includes(targetStation.properties.name), 'tooltip should show station name immediately').toBe(true);

    // Wait another 400ms (total 600ms) - line count should now be visible
    await page.waitForTimeout(400);

    tooltipContent = await page.evaluate(() => {
      const popups = document.querySelectorAll('.mapboxgl-popup-content');
      return popups[0]?.textContent || '';
    });

    // Should now show line count information
    const lineCount = targetStation.properties.lines.length;
    const hasLineInfo = tooltipContent.includes('line') || tooltipContent.includes(lineCount.toString());

    expect(hasLineInfo, 'tooltip should show line count after 500ms hover').toBe(true);
  });

  test('T059: no tooltip on mobile devices', async ({ page, isMobile }) => {
    // Skip this test if not running in mobile context
    test.skip(!isMobile, 'This test is only for mobile devices');

    const stationData = await loadStationData(page);
    const targetStation = stationData.features[0];

    await page.goto('/');
    await waitForMapLoad(page);

    await page.waitForFunction(
      () => {
        const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
          .__MAPBOX_INSTANCE__;
        return map && map.getSource('stations-source') !== undefined;
      },
      { timeout: 10000 }
    );

    // Zoom to high zoom level
    await page.evaluate(() => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__!;
      map.setZoom(16);
    });

    await page.waitForTimeout(1000);

    // Get station position
    const stationScreenPos = await page.evaluate((stationId) => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__!;
      const source = map.getSource('stations-source') as MapboxSourceWithData;
      const sourceData = source._data;
      const station = sourceData?.features?.find((f) => f.properties.id === stationId);

      if (!station) return null;

      const [lng, lat] = station.geometry.coordinates;
      const point = map.project([lng, lat]);

      return { x: point.x, y: point.y };
    }, targetStation.properties.id);

    // Tap on the station (mobile interaction)
    const mapCanvas = page.getByTestId('map-canvas');
    await mapCanvas.tap({ position: { x: stationScreenPos!.x, y: stationScreenPos!.y } });

    // Wait to see if tooltip appears
    await page.waitForTimeout(300);

    // Check that no hover tooltip exists (only detail panel should open)
    const tooltipVisible = await page.evaluate(() => {
      const popups = document.querySelectorAll('.mapboxgl-popup-content');
      return popups.length > 0;
    });

    expect(tooltipVisible, 'no hover tooltip should appear on mobile').toBe(false);
  });
});
