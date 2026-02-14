import type {
  LineGeometryCollection,
  LineProximityConfig,
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
import type { RodaliesLineResolver } from '../trains/lineResolver';
import { preprocessRailwayLine, snapTrainToRailway } from '../trains/geometry';

const RODALIES_DATA_ROOT = 'rodalies_data';
const MANIFEST_FILENAME = 'manifest.json';
const FALLBACK_VIEWPORT: MapViewport = {
  center: { lat: 41.3896, lng: 2.170302 },
  zoom: 15.5,
  max_bounds: [
    [0.249476, 40.395723],
    [3.363469, 42.65891],
  ],
  padding: { top: 48, right: 24, bottom: 48, left: 24 },
};

const baseUrl =
  (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';

const manifestUrl = resolveFromBase(`${RODALIES_DATA_ROOT}/${MANIFEST_FILENAME}`);

/**
 * localStorage key for cached manifest
 * Used as fallback when network is unavailable
 */
const MANIFEST_CACHE_KEY = 'minibarcelona3d_manifest_cache';

/**
 * Cache manifest to localStorage for offline fallback
 */
function cacheManifestToLocalStorage(manifest: RodaliesManifest): void {
  try {
    const cacheEntry = {
      manifest,
      cachedAt: Date.now(),
    };
    localStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify(cacheEntry));
  } catch (error) {
    // localStorage may be unavailable or full - non-fatal
    console.warn('Failed to cache manifest to localStorage:', error);
  }
}

/**
 * Try to load manifest from localStorage cache
 * Returns null if cache is not available or expired (>24 hours)
 */
function loadManifestFromLocalStorage(): RodaliesManifest | null {
  try {
    const cached = localStorage.getItem(MANIFEST_CACHE_KEY);
    if (!cached) return null;

    const { manifest, cachedAt } = JSON.parse(cached) as {
      manifest: RodaliesManifest;
      cachedAt: number;
    };

    // Expire cache after 24 hours
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    if (Date.now() - cachedAt > CACHE_TTL_MS) {
      localStorage.removeItem(MANIFEST_CACHE_KEY);
      return null;
    }

    return manifest;
  } catch (error) {
    // Cache corrupted or unavailable - non-fatal
    console.warn('Failed to load manifest from localStorage:', error);
    return null;
  }
}

let manifestPromise: Promise<RodaliesManifest> | null = null;
const lineCollectionCache = new Map<string, Promise<RodaliesLineCollection>>();
let stationCollectionPromise: Promise<StationFeatureCollection> | null = null;
let stationListPromise: Promise<Station[]> | null = null;
let lineGeometryCollectionPromise: Promise<LineGeometryCollection> | null = null;
let rodaliesLineListPromise: Promise<RodaliesLine[]> | null = null;
let legendEntriesPromise: Promise<LegendEntry[]> | null = null;
let mapViewportPromise: Promise<MapViewport> | null = null;
let mapUiStatePromise: Promise<MapUIState> | null = null;
let lineProximityConfigPromise: Promise<LineProximityConfig> | null = null;

export async function loadManifest(): Promise<RodaliesManifest> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      try {
        // Critical file - use retry mechanism
        const manifest = await fetchJsonWithRetry<RodaliesManifest>(manifestUrl, 'Manifest');
        // Cache successful fetch for offline fallback
        cacheManifestToLocalStorage(manifest);
        return manifest;
      } catch (error) {
        // Try localStorage fallback
        const cachedManifest = loadManifestFromLocalStorage();
        if (cachedManifest) {
          console.warn('Using cached manifest from localStorage due to network error');
          return cachedManifest;
        }
        // No fallback available - re-throw original error
        throw error;
      }
    })();
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
      // Critical file - use retry mechanism
      return fetchJsonWithRetry<StationFeatureCollection>(url, 'Stations');
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
      // Critical file - use retry mechanism
      return fetchJsonWithRetry<LineGeometryCollection>(url, 'Line geometry');
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
          selectedStationId: null,
          stationLoadError: null,
          transportFilters: { rodalies: true, metro: false, bus: false, tram: false, fgc: false },
          networkHighlights: {
            rodalies: { highlightMode: 'none', selectedLineIds: [] },
            metro: { highlightMode: 'none', selectedLineIds: [] },
            bus: { highlightMode: 'none', selectedLineIds: [] },
            tram: { highlightMode: 'none', selectedLineIds: [] },
            fgc: { highlightMode: 'none', selectedLineIds: [] },
          },
          modelSizes: { rodalies: 1.0, metro: 1.0, bus: 1.0, tram: 1.0, fgc: 1.0 },
          activeControlTab: 'rodalies',
          controlPanelMode: 'controls',
          showStations: true,
          showOnlyTopBusLines: true,
          enableTrainParking: true,
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
  if (!stationListPromise) {
    stationListPromise = (async () => {
      const stationFeatures = await loadStations(manifest);
      return stationFeatures.features.map((feature) => ({
        id: feature.properties.id,
        name: feature.properties.name,
        code: feature.properties.code ?? null,
        lines: feature.properties.lines, // Share reference instead of copying
        geometry: feature.geometry,
      }));
    })();
  }
  return stationListPromise;
}

export async function loadLineProximityConfig(): Promise<LineProximityConfig> {
  if (!lineProximityConfigPromise) {
    lineProximityConfigPromise = (async () => {
      // Direct path to the proximity config file (not in manifest)
      const url = resolveFromBase(`${RODALIES_DATA_ROOT}/LineProximity.json`);
      return fetchJson<LineProximityConfig>(url);
    })();
  }
  return lineProximityConfigPromise;
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

/**
 * Default timeout for static data fetches (10 seconds)
 * Slightly shorter than API timeout since static files should load quickly
 */
const STATIC_DATA_TIMEOUT_MS = 10000;

/**
 * Retry configuration for critical static files
 */
const STATIC_RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 2000,
};

/**
 * Calculates exponential backoff delay with jitter for static file retries
 */
function getStaticRetryDelay(attempt: number): number {
  const exponentialDelay = Math.min(
    STATIC_RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1),
    STATIC_RETRY_CONFIG.maxDelayMs
  );
  // Add random jitter (0-30% of delay)
  const jitter = Math.random() * exponentialDelay * 0.3;
  return exponentialDelay + jitter;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches JSON with automatic retry for transient failures
 * Used for critical static files that must load for the app to function
 */
async function fetchJsonWithRetry<T>(
  url: string,
  logPrefix: string = 'Static data'
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= STATIC_RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      return await fetchJson<T>(url);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on 404 - file doesn't exist
      if (lastError.message.includes('not found') || lastError.message.includes('404')) {
        throw lastError;
      }

      if (attempt < STATIC_RETRY_CONFIG.maxAttempts) {
        const delay = getStaticRetryDelay(attempt);
        console.warn(
          `${logPrefix} fetch failed (attempt ${attempt}/${STATIC_RETRY_CONFIG.maxAttempts}): ${lastError.message}. Retrying in ${Math.round(delay)}ms...`
        );
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `${logPrefix} failed after ${STATIC_RETRY_CONFIG.maxAttempts} attempts: ${lastError?.message || 'Unknown error'}`
  );
}

async function fetchJson<T>(url: string, timeoutMs: number = STATIC_DATA_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

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
    clearTimeout(timeoutId);

    // Handle timeout errors
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `Request timed out loading ${url} after ${timeoutMs}ms. Check your internet connection.`,
      );
    }

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
    selectedStationId: null,
    stationLoadError: null,
    transportFilters: {
      rodalies: candidate?.transportFilters?.rodalies ?? true,
      metro: candidate?.transportFilters?.metro ?? false,
      bus: candidate?.transportFilters?.bus ?? false,
      tram: candidate?.transportFilters?.tram ?? false,
      fgc: candidate?.transportFilters?.fgc ?? false,
    },
    networkHighlights: {
      rodalies: { highlightMode: 'none', selectedLineIds: [] },
      metro: { highlightMode: 'none', selectedLineIds: [] },
      bus: { highlightMode: 'none', selectedLineIds: [] },
      tram: { highlightMode: 'none', selectedLineIds: [] },
      fgc: { highlightMode: 'none', selectedLineIds: [] },
    },
    modelSizes: { rodalies: 1.0, metro: 1.0, bus: 1.0, tram: 1.0, fgc: 1.0 },
    activeControlTab: 'rodalies',
    controlPanelMode: 'controls',
    showStations: candidate?.showStations ?? true,
    showOnlyTopBusLines: candidate?.showOnlyTopBusLines ?? true,
    enableTrainParking: candidate?.enableTrainParking ?? true,
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

/**
 * Precompute and cache line bearings at all stations
 *
 * For each station, for each line that serves it:
 * 1. Snap the station position to the line's geometry
 * 2. Extract the bearing at that snap point
 * 3. Store in the LineResolver's bearing cache
 *
 * This computation happens once at load time to avoid per-frame calculations
 * during rendering and position updates.
 *
 * Phase 0, Task T000c
 *
 * @param lineResolver - RodaliesLineResolver to populate with bearings
 * @param manifest - Optional manifest (uses cached if not provided)
 * @returns Number of line-station bearings computed
 */
export async function precomputeLineBearings(
  lineResolver: RodaliesLineResolver,
  manifest?: RodaliesManifest,
): Promise<number> {
  const [stations, lineGeometries, lines] = await Promise.all([
    loadStationList(manifest),
    loadLineGeometryCollection(manifest),
    loadRodaliesLines(manifest),
  ]);

  // Build a map of line geometries for quick lookup
  const lineGeometryMap = new Map(
    lineGeometries.features.map((feature) => [
      feature.properties.id,
      feature.geometry,
    ]),
  );

  // Build a set of line IDs for validation
  const lineIdSet = new Set(lines.map((line) => line.id));

  let bearingsComputed = 0;

  // For each station
  for (const station of stations) {
    const stationPosition: [number, number] = [
      station.geometry.coordinates[0],
      station.geometry.coordinates[1],
    ];

    // For each line that serves this station
    for (const lineId of station.lines) {
      // Validate line exists
      if (!lineIdSet.has(lineId)) {
        console.warn(
          `Station ${station.id} references unknown line ${lineId}. Skipping bearing computation.`,
        );
        continue;
      }

      // Get line geometry
      const geometry = lineGeometryMap.get(lineId);
      if (!geometry) {
        console.warn(
          `No geometry found for line ${lineId} at station ${station.id}. Skipping bearing computation.`,
        );
        continue;
      }

      // Preprocess railway line for snapping
      const preprocessed = preprocessRailwayLine(geometry);
      if (!preprocessed) {
        console.warn(
          `Failed to preprocess geometry for line ${lineId}. Skipping bearing computation.`,
        );
        continue;
      }

      // Snap station to railway line to get bearing
      const snapResult = snapTrainToRailway(stationPosition, preprocessed);
      if (!snapResult) {
        console.warn(
          `Failed to snap station ${station.id} to line ${lineId}. Skipping bearing computation.`,
        );
        continue;
      }

      // Store bearing in cache
      lineResolver.setBearingAtStation(lineId, station.id, snapResult.bearing);

      // Also store membership (line serves station)
      lineResolver.setLineServesStation(lineId, station.id, true);

      bearingsComputed++;
    }
  }

  return bearingsComputed;
}
