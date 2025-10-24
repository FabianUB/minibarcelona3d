import type {
  LineGeometryCollection,
  LegendEntry,
  MapHighlightMode,
  MapUIState,
  MapViewport,
  RodaliesLine,
  RodaliesLineCollection,
  RodaliesManifest,
  Station,
  StationFeatureCollection,
} from '../../types/rodalies';

const RODALIES_DATA_ROOT = 'rodalies_data';
const MANIFEST_FILENAME = 'manifest.json';
const FALLBACK_VIEWPORT: MapViewport = {
  center: { lat: 41.527316, lng: 1.806473 },
  zoom: 8.2,
  max_bounds: [
    [0.249476, 40.395723],
    [3.363469, 42.65891],
  ],
  padding: { top: 48, right: 24, bottom: 48, left: 24 },
};

const baseUrl =
  (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';

const manifestUrl = resolveFromBase(`${RODALIES_DATA_ROOT}/${MANIFEST_FILENAME}`);

let manifestPromise: Promise<RodaliesManifest> | null = null;
const lineCollectionCache = new Map<string, Promise<RodaliesLineCollection>>();
let stationCollectionPromise: Promise<StationFeatureCollection> | null = null;
let lineGeometryCollectionPromise: Promise<LineGeometryCollection> | null = null;
let rodaliesLineListPromise: Promise<RodaliesLine[]> | null = null;
let legendEntriesPromise: Promise<LegendEntry[]> | null = null;
let mapViewportPromise: Promise<MapViewport> | null = null;
let mapUiStatePromise: Promise<MapUIState> | null = null;

export async function loadManifest(): Promise<RodaliesManifest> {
  if (!manifestPromise) {
    manifestPromise = fetchJson<RodaliesManifest>(manifestUrl);
  }
  return manifestPromise;
}

export async function loadStations(
  manifest?: RodaliesManifest,
): Promise<StationFeatureCollection> {
  if (!stationCollectionPromise) {
    stationCollectionPromise = (async () => {
      const manifestData = manifest ?? (await loadManifest());
      const stationPath = manifestData.stations?.path;
      if (!stationPath) {
        throw new Error('Rodalies manifest is missing stations.path');
      }
      const url = resolveManifestAssetUrl(stationPath);
      return fetchJson<StationFeatureCollection>(url);
    })();
  }
  return stationCollectionPromise;
}

export async function loadLineCollection(
  lineId: string,
  manifest?: RodaliesManifest,
): Promise<RodaliesLineCollection> {
  const normalisedLineId = lineId.trim();
  if (!normalisedLineId) {
    throw new Error('A non-empty line identifier is required');
  }

  if (!lineCollectionCache.has(normalisedLineId)) {
    lineCollectionCache.set(
      normalisedLineId,
      (async () => {
        const manifestData = manifest ?? (await loadManifest());
        const entry = manifestData.lines.find(
          (item) => item.id === normalisedLineId,
        );
        if (!entry) {
          throw new Error(
            `Line "${normalisedLineId}" is not listed in the Rodalies manifest`,
          );
        }
        const url = resolveManifestAssetUrl(entry.path);
        return fetchJson<RodaliesLineCollection>(url);
      })(),
    );
  }

  return lineCollectionCache.get(normalisedLineId)!;
}

export async function loadLineGeometryCollection(
  manifest?: RodaliesManifest,
): Promise<LineGeometryCollection> {
  if (!lineGeometryCollectionPromise) {
    lineGeometryCollectionPromise = (async () => {
      const manifestData = manifest ?? (await loadManifest());
      const path =
        manifestData.line_geometries_path ?? 'LineGeometry.geojson';
      const url = resolveManifestAssetUrl(path);
      return fetchJson<LineGeometryCollection>(url);
    })();
  }
  return lineGeometryCollectionPromise;
}

export async function loadRodaliesLines(
  manifest?: RodaliesManifest,
): Promise<RodaliesLine[]> {
  if (!rodaliesLineListPromise) {
    rodaliesLineListPromise = (async () => {
      const manifestData = manifest ?? (await loadManifest());
      const path = manifestData.rodalies_lines_path;
      if (!path) {
        return [];
      }
      const url = resolveManifestAssetUrl(path);
      return fetchJson<RodaliesLine[]>(url);
    })();
  }
  return rodaliesLineListPromise;
}

export async function loadLegendEntries(
  manifest?: RodaliesManifest,
): Promise<LegendEntry[]> {
  if (!legendEntriesPromise) {
    legendEntriesPromise = (async () => {
      const manifestData = manifest ?? (await loadManifest());
      const path = manifestData.legend_entries_path;
      if (!path) {
        return [];
      }
      const url = resolveManifestAssetUrl(path);
      return fetchJson<LegendEntry[]>(url);
    })();
  }
  return legendEntriesPromise;
}

export async function loadMapViewport(
  manifest?: RodaliesManifest,
): Promise<MapViewport> {
  if (!mapViewportPromise) {
    mapViewportPromise = (async () => {
      const manifestData = manifest ?? (await loadManifest());
      if (manifestData.viewport) {
        return manifestData.viewport;
      }
      const path = manifestData.map_viewport_path;
      if (!path) {
        return FALLBACK_VIEWPORT;
      }
      const url = resolveManifestAssetUrl(path);
      return fetchJson<MapViewport>(url);
    })();
  }
  return mapViewportPromise;
}

export async function loadMapUiState(
  manifest?: RodaliesManifest,
): Promise<MapUIState> {
  if (!mapUiStatePromise) {
    mapUiStatePromise = (async () => {
      const manifestData = manifest ?? (await loadManifest());
      const path = manifestData.map_ui_state_path;
      if (!path) {
        return {
          selectedLineId: null,
          selectedLineIds: [],
          highlightMode: 'none',
          isHighContrast: false,
          isLegendOpen: false,
          activePanel: 'none',
        };
      }
      const url = resolveManifestAssetUrl(path);
      const remoteState = await fetchJson<Partial<MapUIState>>(url);
      return normaliseMapUiState(remoteState);
    })();
  }
  return mapUiStatePromise;
}

export async function loadStationList(
  manifest?: RodaliesManifest,
): Promise<Station[]> {
  const stationFeatures = await loadStations(manifest);
  return stationFeatures.features.map((feature) => ({
    id: feature.properties.id,
    name: feature.properties.name,
    code: feature.properties.code ?? null,
    lines: [...feature.properties.lines],
    geometry: feature.geometry,
  }));
}

export function getFallbackViewport(): MapViewport {
  return {
    center: { ...FALLBACK_VIEWPORT.center },
    zoom: FALLBACK_VIEWPORT.zoom,
    max_bounds: [
      [...FALLBACK_VIEWPORT.max_bounds[0]] as typeof FALLBACK_VIEWPORT.max_bounds[0],
      [...FALLBACK_VIEWPORT.max_bounds[1]] as typeof FALLBACK_VIEWPORT.max_bounds[1],
    ],
    padding: { ...FALLBACK_VIEWPORT.padding },
  };
}

function resolveManifestAssetUrl(path: string): string {
  return resolveFromBase(
    path.startsWith(RODALIES_DATA_ROOT)
      ? path
      : `${RODALIES_DATA_ROOT}/${stripLeadingSlash(path)}`,
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      // Provide more specific error messages based on status code
      let errorMessage = `Failed to fetch ${url}: ${response.status} ${response.statusText}`;

      if (response.status === 404) {
        errorMessage = `Resource not found: ${url}. Check that the file exists in the public/rodalies_data directory.`;
      } else if (response.status === 403) {
        errorMessage = `Access forbidden: ${url}. Check file permissions.`;
      } else if (response.status >= 500) {
        errorMessage = `Server error loading ${url}: ${response.status}. Please try again later.`;
      }

      throw new Error(errorMessage);
    }

    try {
      return (await response.json()) as T;
    } catch (parseError) {
      throw new Error(
        `Invalid JSON in ${url}: ${parseError instanceof Error ? parseError.message : 'Parse error'}`,
      );
    }
  } catch (error) {
    // Handle network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(
        `Network error loading ${url}. Check your internet connection.`,
      );
    }
    throw error;
  }
}

function resolveFromBase(path: string): string {
  if (isAbsoluteUrl(path)) {
    return path;
  }
  const sanitisedPath = `/${stripLeadingSlash(path)}`;
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${sanitisedPath}`;
}

function stripLeadingSlash(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path;
}

function isAbsoluteUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

function normaliseMapUiState(
  candidate: Partial<MapUIState> | null | undefined,
): MapUIState {
  const highlightMode = validateHighlightMode(candidate?.highlightMode);
  const selectedLineId =
    typeof candidate?.selectedLineId === 'string' &&
    candidate.selectedLineId.trim().length > 0
      ? candidate.selectedLineId.trim()
      : null;
  const selectedLineIds = Array.isArray(candidate?.selectedLineIds)
    ? candidate.selectedLineIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : selectedLineId ? [selectedLineId] : [];
  return {
    selectedLineId,
    selectedLineIds,
    highlightMode,
    isHighContrast: Boolean(candidate?.isHighContrast),
    isLegendOpen: Boolean(candidate?.isLegendOpen),
    activePanel: candidate?.activePanel === 'legend' || candidate?.activePanel === 'settings' ? candidate.activePanel : 'none',
  };
}

function validateHighlightMode(
  mode: unknown,
): MapHighlightMode {
  if (mode === 'highlight' || mode === 'isolate') {
    return mode;
  }
  return 'none';
}
