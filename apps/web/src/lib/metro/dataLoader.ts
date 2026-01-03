/**
 * Data loader for Barcelona Metro static data.
 * Uses promise caching to prevent duplicate fetches.
 */

import type {
  TmbManifest,
  MetroStationCollection,
  MetroLineCollection,
  MetroLine,
} from '../../types/metro';
import { METRO_LINES } from '../../types/metro';

const TMB_DATA_ROOT = 'tmb_data';
const MANIFEST_FILENAME = 'manifest.json';

const baseUrl =
  (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';

// Promise caches
let manifestPromise: Promise<TmbManifest> | null = null;
let metroStationsPromise: Promise<MetroStationCollection> | null = null;
const metroLineCache = new Map<string, Promise<MetroLineCollection>>();
let allMetroLinesPromise: Promise<MetroLineCollection> | null = null;
let busStopsPromise: Promise<MetroStationCollection> | null = null;
let allBusRoutesPromise: Promise<MetroLineCollection> | null = null;

/**
 * Load the TMB manifest file
 */
export async function loadTmbManifest(): Promise<TmbManifest> {
  if (!manifestPromise) {
    const url = resolveFromBase(`${TMB_DATA_ROOT}/${MANIFEST_FILENAME}`);
    manifestPromise = fetchJson<TmbManifest>(url);
  }
  return manifestPromise;
}

/**
 * Load Metro stations GeoJSON
 */
export async function loadMetroStations(
  manifest?: TmbManifest
): Promise<MetroStationCollection> {
  if (!metroStationsPromise) {
    metroStationsPromise = (async () => {
      const manifestData = manifest ?? (await loadTmbManifest());
      const stationsFile = manifestData.files.find(
        (f) => f.type === 'metro_stations'
      );
      if (!stationsFile) {
        throw new Error('TMB manifest is missing metro_stations entry');
      }
      const url = resolveAssetUrl(stationsFile.path);
      return fetchJson<MetroStationCollection>(url);
    })();
  }
  return metroStationsPromise;
}

/**
 * Load a single Metro line geometry
 */
export async function loadMetroLine(
  lineCode: string,
  manifest?: TmbManifest
): Promise<MetroLineCollection> {
  const normalizedCode = lineCode.trim().toUpperCase();

  if (!metroLineCache.has(normalizedCode)) {
    metroLineCache.set(
      normalizedCode,
      (async () => {
        const manifestData = manifest ?? (await loadTmbManifest());
        const lineFile = manifestData.files.find(
          (f) => f.type === 'metro_line' && f.line_code === lineCode
        );
        if (!lineFile) {
          throw new Error(`Metro line ${lineCode} not found in manifest`);
        }
        const url = resolveAssetUrl(lineFile.path);
        return fetchJson<MetroLineCollection>(url);
      })()
    );
  }

  return metroLineCache.get(normalizedCode)!;
}

/**
 * Load all Metro line geometries as a single FeatureCollection
 */
export async function loadAllMetroLines(
  manifest?: TmbManifest
): Promise<MetroLineCollection> {
  if (!allMetroLinesPromise) {
    allMetroLinesPromise = (async () => {
      const manifestData = manifest ?? (await loadTmbManifest());
      const lineFiles = manifestData.files.filter(
        (f) => f.type === 'metro_line'
      );

      // Load all line files in parallel
      const lineCollections = await Promise.all(
        lineFiles.map(async (file) => {
          const url = resolveAssetUrl(file.path);
          return fetchJson<MetroLineCollection>(url);
        })
      );

      // Merge all features into a single FeatureCollection
      const allFeatures = lineCollections.flatMap((c) => c.features);

      return {
        type: 'FeatureCollection' as const,
        features: allFeatures,
      };
    })();
  }
  return allMetroLinesPromise;
}

/**
 * Get Metro line metadata (colors, names)
 */
export function getMetroLines(): MetroLine[] {
  return METRO_LINES;
}

/**
 * Get Metro line by code
 */
export function getMetroLineByCode(lineCode: string): MetroLine | undefined {
  return METRO_LINES.find(
    (line) => line.lineCode.toUpperCase() === lineCode.toUpperCase()
  );
}

/**
 * Get available Metro line codes from manifest
 */
export async function getAvailableMetroLineCodes(
  manifest?: TmbManifest
): Promise<string[]> {
  const manifestData = manifest ?? (await loadTmbManifest());
  return manifestData.files
    .filter((f) => f.type === 'metro_line' && f.line_code)
    .map((f) => f.line_code!);
}

// --- Bus data loading functions ---

/**
 * Load Bus stops GeoJSON
 * Uses same structure as Metro stations
 */
export async function loadBusStops(
  manifest?: TmbManifest
): Promise<MetroStationCollection> {
  if (!busStopsPromise) {
    busStopsPromise = (async () => {
      const manifestData = manifest ?? (await loadTmbManifest());
      const stopsFile = manifestData.files.find(
        (f) => f.type === 'bus_stops'
      );
      if (!stopsFile) {
        throw new Error('TMB manifest is missing bus_stops entry');
      }
      const url = resolveAssetUrl(stopsFile.path);
      return fetchJson<MetroStationCollection>(url);
    })();
  }
  return busStopsPromise;
}

/**
 * Load all Bus route geometries as a single FeatureCollection
 * Uses same structure as Metro lines
 */
export async function loadAllBusRoutes(
  manifest?: TmbManifest
): Promise<MetroLineCollection> {
  if (!allBusRoutesPromise) {
    allBusRoutesPromise = (async () => {
      const manifestData = manifest ?? (await loadTmbManifest());
      const routeFiles = manifestData.files.filter(
        (f) => f.type === 'bus_route'
      );

      // Load all route files in parallel
      const routeCollections = await Promise.all(
        routeFiles.map(async (file) => {
          const url = resolveAssetUrl(file.path);
          return fetchJson<MetroLineCollection>(url);
        })
      );

      // Merge all features into a single FeatureCollection
      const allFeatures = routeCollections.flatMap((c) => c.features);

      return {
        type: 'FeatureCollection' as const,
        features: allFeatures,
      };
    })();
  }
  return allBusRoutesPromise;
}

/**
 * Get available Bus route codes from manifest
 */
export async function getAvailableBusRouteCodes(
  manifest?: TmbManifest
): Promise<string[]> {
  const manifestData = manifest ?? (await loadTmbManifest());
  return manifestData.files
    .filter((f) => f.type === 'bus_route' && f.route_code)
    .map((f) => f.route_code!);
}

// --- TRAM data loading functions ---

let tramStopsPromise: Promise<MetroStationCollection> | null = null;
let allTramLinesPromise: Promise<MetroLineCollection> | null = null;

/**
 * Load TRAM stops GeoJSON
 */
export async function loadTramStops(
  manifest?: TmbManifest
): Promise<MetroStationCollection> {
  if (!tramStopsPromise) {
    tramStopsPromise = (async () => {
      const manifestData = manifest ?? (await loadTmbManifest());
      const stopsFile = manifestData.files.find(
        (f) => f.type === 'tram_stations'
      );
      if (!stopsFile) {
        throw new Error('TMB manifest is missing tram_stations entry');
      }
      const url = resolveAssetUrl(stopsFile.path);
      return fetchJson<MetroStationCollection>(url);
    })();
  }
  return tramStopsPromise;
}

/**
 * Load all TRAM line geometries as a single FeatureCollection
 */
export async function loadAllTramLines(
  manifest?: TmbManifest
): Promise<MetroLineCollection> {
  if (!allTramLinesPromise) {
    allTramLinesPromise = (async () => {
      const manifestData = manifest ?? (await loadTmbManifest());
      const lineFiles = manifestData.files.filter(
        (f) => f.type === 'tram_line'
      );

      const lineCollections = await Promise.all(
        lineFiles.map(async (file) => {
          const url = resolveAssetUrl(file.path);
          return fetchJson<MetroLineCollection>(url);
        })
      );

      const allFeatures = lineCollections.flatMap((c) => c.features);

      return {
        type: 'FeatureCollection' as const,
        features: allFeatures,
      };
    })();
  }
  return allTramLinesPromise;
}

/**
 * Get available TRAM line codes from manifest
 */
export async function getAvailableTramLineCodes(
  manifest?: TmbManifest
): Promise<string[]> {
  const manifestData = manifest ?? (await loadTmbManifest());
  return manifestData.files
    .filter((f) => f.type === 'tram_line' && f.line_code)
    .map((f) => f.line_code!);
}

// --- FGC data loading functions ---

let fgcStationsPromise: Promise<MetroStationCollection> | null = null;
let allFgcLinesPromise: Promise<MetroLineCollection> | null = null;

/**
 * Load FGC stations GeoJSON
 */
export async function loadFgcStations(
  manifest?: TmbManifest
): Promise<MetroStationCollection> {
  if (!fgcStationsPromise) {
    fgcStationsPromise = (async () => {
      const manifestData = manifest ?? (await loadTmbManifest());
      const stationsFile = manifestData.files.find(
        (f) => f.type === 'fgc_stations'
      );
      if (!stationsFile) {
        throw new Error('TMB manifest is missing fgc_stations entry');
      }
      const url = resolveAssetUrl(stationsFile.path);
      return fetchJson<MetroStationCollection>(url);
    })();
  }
  return fgcStationsPromise;
}

/**
 * Load all FGC line geometries as a single FeatureCollection
 */
export async function loadAllFgcLines(
  manifest?: TmbManifest
): Promise<MetroLineCollection> {
  if (!allFgcLinesPromise) {
    allFgcLinesPromise = (async () => {
      const manifestData = manifest ?? (await loadTmbManifest());
      const lineFiles = manifestData.files.filter(
        (f) => f.type === 'fgc_line'
      );

      const lineCollections = await Promise.all(
        lineFiles.map(async (file) => {
          const url = resolveAssetUrl(file.path);
          return fetchJson<MetroLineCollection>(url);
        })
      );

      const allFeatures = lineCollections.flatMap((c) => c.features);

      return {
        type: 'FeatureCollection' as const,
        features: allFeatures,
      };
    })();
  }
  return allFgcLinesPromise;
}

/**
 * Get available FGC line codes from manifest
 */
export async function getAvailableFgcLineCodes(
  manifest?: TmbManifest
): Promise<string[]> {
  const manifestData = manifest ?? (await loadTmbManifest());
  return manifestData.files
    .filter((f) => f.type === 'fgc_line' && f.line_code)
    .map((f) => f.line_code!);
}

// --- Helper functions ---

function resolveAssetUrl(path: string): string {
  return resolveFromBase(
    path.startsWith(TMB_DATA_ROOT)
      ? path
      : `${TMB_DATA_ROOT}/${stripLeadingSlash(path)}`
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    let errorMessage = `Failed to fetch ${url}: ${response.status} ${response.statusText}`;

    if (response.status === 404) {
      errorMessage = `Resource not found: ${url}. Check that the file exists in the public/tmb_data directory.`;
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
      `Invalid JSON in ${url}: ${parseError instanceof Error ? parseError.message : 'Parse error'}`
    );
  }
}

function resolveFromBase(path: string): string {
  if (isAbsoluteUrl(path)) {
    return path;
  }
  const sanitizedPath = `/${stripLeadingSlash(path)}`;
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${sanitizedPath}`;
}

function stripLeadingSlash(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path;
}

function isAbsoluteUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

/**
 * Clear all cached data (useful for testing or forced refresh)
 */
export function clearMetroCache(): void {
  manifestPromise = null;
  metroStationsPromise = null;
  metroLineCache.clear();
  allMetroLinesPromise = null;
  busStopsPromise = null;
  allBusRoutesPromise = null;
  tramStopsPromise = null;
  allTramLinesPromise = null;
  fgcStationsPromise = null;
  allFgcLinesPromise = null;
}
