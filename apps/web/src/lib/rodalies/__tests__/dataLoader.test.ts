import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RodaliesManifest } from '../../../types/rodalies';

type FetchResponseMap = Record<string, unknown>;

const manifestUrl = '/rodalies_data/manifest.json';

function createFetchMock(responses: FetchResponseMap) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (!Object.prototype.hasOwnProperty.call(responses, url)) {
      return new Response(null, { status: 404, statusText: 'Not Found' });
    }

    const body = responses[url];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  });
}

function createManifest(overrides: Partial<RodaliesManifest> = {}): RodaliesManifest {
  return {
    updated_at: '2025-01-01T00:00:00Z',
    viewport: {
      center: { lat: 41.3851, lng: 2.1734 },
      zoom: 9,
      max_bounds: [
        [1.5, 40.5],
        [3.5, 42.0],
      ],
      padding: { top: 48, right: 48, bottom: 64, left: 48 },
    },
    lines: [
      {
        id: 'R1',
        checksum: 'a'.repeat(64),
        path: 'lines/R1.geojson',
      },
    ],
    stations: {
      path: 'Station.geojson',
      checksum: 'b'.repeat(64),
    },
    rodalies_lines_path: undefined,
    legend_entries_path: undefined,
    line_geometries_path: undefined,
    map_viewport_path: undefined,
    map_ui_state_path: undefined,
    ...overrides,
  };
}

describe('rodalies dataLoader', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('loads manifest once and reuses the cached promise', async () => {
    const manifest = createManifest();
    const responses: FetchResponseMap = {
      [manifestUrl]: manifest,
    };
    const fetchMock = createFetchMock(responses);
    vi.stubGlobal('fetch', fetchMock);

    const { loadManifest } = await import('../dataLoader');

    await loadManifest();
    await loadManifest();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves a line collection using manifest metadata', async () => {
    const lineCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            id: 'R1',
            name: 'R1',
            short_code: 'R1',
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              [2.0, 41.0],
              [2.1, 41.1],
            ],
          },
        },
      ],
    };

    const manifest = createManifest();
    const responses: FetchResponseMap = {
      [manifestUrl]: manifest,
      '/rodalies_data/lines/R1.geojson': lineCollection,
    };

    const fetchMock = createFetchMock(responses);
    vi.stubGlobal('fetch', fetchMock);

    const { loadLineCollection } = await import('../dataLoader');

    const collection = await loadLineCollection('R1');

    expect(collection).toEqual(lineCollection);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await loadLineCollection('R1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a descriptive error when requesting an unknown line', async () => {
    const manifest = createManifest();
    const responses: FetchResponseMap = {
      [manifestUrl]: manifest,
    };
    const fetchMock = createFetchMock(responses);
    vi.stubGlobal('fetch', fetchMock);

    const { loadLineCollection } = await import('../dataLoader');

    await expect(loadLineCollection('R99')).rejects.toThrow(
      /not listed in the Rodalies manifest/i,
    );
  });

  it('returns inline viewport defaults from the manifest when present', async () => {
    const manifest = createManifest();
    const responses: FetchResponseMap = {
      [manifestUrl]: manifest,
    };
    const fetchMock = createFetchMock(responses);
    vi.stubGlobal('fetch', fetchMock);

    const { loadMapViewport } = await import('../dataLoader');

    const viewport = await loadMapViewport();

    expect(viewport).toEqual(manifest.viewport);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('supplies a fallback Map UI state when manifest path is absent', async () => {
    const manifest = createManifest({ map_ui_state_path: undefined });
    const responses: FetchResponseMap = {
      [manifestUrl]: manifest,
    };
    const fetchMock = createFetchMock(responses);
    vi.stubGlobal('fetch', fetchMock);

    const { loadMapUiState } = await import('../dataLoader');

    const uiState = await loadMapUiState();
    expect(uiState).toEqual({
      selectedLineId: null,
      selectedLineIds: [],
      selectedStationId: null,
      highlightMode: 'none',
      isHighContrast: false,
      isLegendOpen: false,
      activePanel: 'none',
      stationLoadError: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('normalises remote Map UI state defaults and invalid highlight modes', async () => {
    const manifest = createManifest({ map_ui_state_path: 'MapUIState.json' });
    const remoteState = {
      selectedLineId: '',
      highlightMode: 'unsupported',
      isLegendOpen: true,
      isHighContrast: 1,
    };
    const responses: FetchResponseMap = {
      [manifestUrl]: manifest,
      '/rodalies_data/MapUIState.json': remoteState,
    };
    const fetchMock = createFetchMock(responses);
    vi.stubGlobal('fetch', fetchMock);

    const { loadMapUiState } = await import('../dataLoader');

    const uiState = await loadMapUiState();
    expect(uiState).toEqual({
      selectedLineId: null,
      selectedLineIds: [],
      selectedStationId: null,
      highlightMode: 'none',
      isLegendOpen: true,
      isHighContrast: true,
      activePanel: 'none',
      stationLoadError: null,
    });
});

  it('exposes an immutable fallback viewport helper', async () => {
    const { getFallbackViewport } = await import('../dataLoader');

    const first = getFallbackViewport();
    const second = getFallbackViewport();

    expect(first).not.toBe(second);
    first.center.lat = 0;
    expect(second.center.lat).not.toBe(0);
  });
});
