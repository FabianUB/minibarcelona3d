import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type mapboxgl from 'mapbox-gl';

const FALLBACK_VIEWPORT = {
  center: { lat: 41.527316, lng: 1.806473 },
  zoom: 8.2,
};

async function resolveExpectedViewport(page: Page) {
  try {
    const manifestResponse = await page.request.get('/rodalies_data/manifest.json');
    if (!manifestResponse.ok()) {
      return FALLBACK_VIEWPORT;
    }
    const manifest = (await manifestResponse.json()) as {
      viewport?: { center: { lat: number; lng: number }; zoom: number };
      map_viewport_path?: string;
    };
    if (manifest.viewport) {
      return manifest.viewport;
    }
    if (manifest.map_viewport_path) {
      const viewportPath = manifest.map_viewport_path;
      const sanitisedPath =
        viewportPath.startsWith('/') ? viewportPath.slice(1) : viewportPath;
      const viewportResponse = await page.request.get(
        `/rodalies_data/${sanitisedPath}`,
      );
      if (viewportResponse.ok()) {
        return (await viewportResponse.json()) as (typeof FALLBACK_VIEWPORT);
      }
    }
  } catch (error) {
    console.warn('Falling back to default viewport in Playwright spec', error);
  }
  return FALLBACK_VIEWPORT;
}

test.describe('Rodalies map default view', () => {
  test('loads centered on the full network with recenter control', async ({
    page,
  }) => {
    await page.goto('/');

    const mapCanvas = page.getByTestId('map-canvas');
    await expect(mapCanvas, 'map canvas should render on initial load').toBeVisible();

    const mapBoundingBox = await mapCanvas.boundingBox();
    expect(mapBoundingBox?.width ?? 0).toBeGreaterThan(640);
    expect(mapBoundingBox?.height ?? 0).toBeGreaterThan(360);

    const recenterButton = page.getByRole('button', { name: /recenter/i });
    await expect(
      recenterButton,
      'recenter control should be present for resetting viewport',
    ).toBeVisible();

    await page.mouse.wheel(0, 400);
    await recenterButton.click();

    const expectedViewport = await resolveExpectedViewport(page);

    const mapCenter = await page.evaluate(() => {
      const map = (window as unknown as { __MAPBOX_INSTANCE__?: mapboxgl.Map })
        .__MAPBOX_INSTANCE__;
      if (!map) {
        throw new Error('Mapbox instance unavailable on window');
      }
      const center = map.getCenter();
      return { lat: center.lat, lng: center.lng, zoom: map.getZoom() };
    });

    const lngDiff = Math.abs(mapCenter.lng - expectedViewport.center.lng);
    const latDiff = Math.abs(mapCenter.lat - expectedViewport.center.lat);
    const zoomDiff = Math.abs(mapCenter.zoom - expectedViewport.zoom);

    expect.soft(
      { lngDiff, latDiff, zoomDiff },
      'map should reset to manifest default viewport with tolerances',
    ).toMatchObject({
      lngDiff: expect.any(Number),
      latDiff: expect.any(Number),
      zoomDiff: expect.any(Number),
    });
    expect.soft(lngDiff).toBeLessThanOrEqual(0.2);
    expect.soft(latDiff).toBeLessThanOrEqual(0.2);
    expect.soft(zoomDiff).toBeLessThanOrEqual(1);
  });

  test('displays warning when line geometry fails to load', async ({ page }) => {
    // Intercept the LineGeometry request and make it fail
    await page.route('**/rodalies_data/LineGeometry.geojson', (route) => {
      route.abort('failed');
    });

    await page.goto('/');

    // Map canvas should still render (base map only)
    const mapCanvas = page.getByTestId('map-canvas');
    await expect(mapCanvas, 'map canvas should render even without line geometry').toBeVisible();

    // Warning message should be displayed
    const warningStatus = page.locator('[role="status"]').filter({
      hasText: /Rodalies line geometry failed to load/i,
    });

    await expect(
      warningStatus,
      'warning should indicate line geometry load failure',
    ).toBeVisible({ timeout: 10000 });

    // Verify the warning message content
    await expect(warningStatus).toContainText('Base map shown only');
  });
});
