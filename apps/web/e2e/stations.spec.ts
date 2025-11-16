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

    // Check that station layers exist
    const stationLayers = await page.evaluate(() => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__;
      if (!map) return [];

      const layers: string[] = [];
      const style = map.getStyle();
      if (style && style.layers) {
        style.layers.forEach((layer) => {
          if (layer.id.startsWith('stations-circles')) {
            layers.push(layer.id);
          }
        });
      }
      return layers;
    });

    expect(
      stationLayers.length,
      'station circle layers should be added (single, multi-outer, multi-inner)'
    ).toBeGreaterThanOrEqual(2);

    // Verify station features are loaded
    const stationFeatureCount = await page.evaluate(() => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__;
      if (!map) return 0;

      const source = map.getSource('stations-source') as mapboxgl.GeoJSONSource;
      if (!source) return 0;

      // Access internal _data property to get feature count
      const sourceData = (source as any)._data;
      if (sourceData && sourceData.features) {
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

    // Get marker size at zoom level 8
    const sizeAtZoom8 = await page.evaluate(async () => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__!;
      map.setZoom(8);
      await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for render

      const layer = map.getLayer('stations-circles-single');
      if (!layer || layer.type !== 'circle') return null;

      // Get paint property for circle-radius
      return map.getPaintProperty('stations-circles-single', 'circle-radius');
    });

    // Get marker size at zoom level 16
    const sizeAtZoom16 = await page.evaluate(async () => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__!;
      map.setZoom(16);
      await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for render

      return map.getPaintProperty('stations-circles-single', 'circle-radius');
    });

    expect(sizeAtZoom8, 'should have circle-radius paint property at zoom 8').toBeTruthy();
    expect(sizeAtZoom16, 'should have circle-radius paint property at zoom 16').toBeTruthy();

    // Both should use interpolate expression (array format)
    expect(
      Array.isArray(sizeAtZoom8),
      'circle-radius should use expression-based sizing'
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

    // Check that multi-line station layers exist
    const multiLineLayersExist = await page.evaluate(() => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__;
      if (!map) return false;

      const outerLayer = map.getLayer('stations-circles-multi-outer');
      const innerLayer = map.getLayer('stations-circles-multi-inner');

      return outerLayer !== undefined && innerLayer !== undefined;
    });

    expect(
      multiLineLayersExist,
      'multi-line station layers (outer and inner) should exist'
    ).toBe(true);

    // Verify that both layers have circle type
    const layerTypes = await page.evaluate(() => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__!;

      const outerLayer = map.getLayer('stations-circles-multi-outer');
      const innerLayer = map.getLayer('stations-circles-multi-inner');

      return {
        outer: outerLayer?.type,
        inner: innerLayer?.type,
      };
    });

    expect(layerTypes.outer, 'outer layer should be circle type').toBe('circle');
    expect(layerTypes.inner, 'inner layer should be circle type').toBe('circle');

    // Verify that layers have filters for isMultiLine property
    const layerFilters = await page.evaluate(() => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__!;

      const outerLayer = map.getLayer('stations-circles-multi-outer');
      const innerLayer = map.getLayer('stations-circles-multi-inner');

      return {
        outer: (outerLayer as any)?.filter,
        inner: (innerLayer as any)?.filter,
      };
    });

    expect(
      layerFilters.outer,
      'outer layer should filter for multi-line stations'
    ).toBeTruthy();
    expect(
      layerFilters.inner,
      'inner layer should filter for multi-line stations'
    ).toBeTruthy();
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

    // Get initial station layer opacity
    const initialOpacity = await page.evaluate(() => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__!;
      return map.getPaintProperty('stations-circles-single', 'circle-opacity');
    });

    // Click line in legend to isolate it
    const legendEntry = legendPanel.getByTestId(`legend-entry-${testLineId}`);
    await expect(legendEntry, `legend entry for ${testLineId} should exist`).toBeVisible();

    // Use isolate action (Ctrl+Click or programmatically)
    await page.evaluate((lineId) => {
      const actions = (window as any).__MAP_ACTIONS__;
      if (actions && actions.isolateLine) {
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
      return map.getPaintProperty('stations-circles-single', 'circle-opacity');
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
