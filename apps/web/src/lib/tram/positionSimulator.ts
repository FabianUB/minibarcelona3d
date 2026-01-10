/**
 * TRAM Position Simulator
 *
 * Generates simulated tram positions for Barcelona TRAM based on
 * schedule data (headway, average speed) rather than real-time GPS.
 *
 * Uses the unified position simulator factory.
 */

import type { VehiclePosition } from '../../types/transit';
import type { MetroLineCollection } from '../../types/metro';
import type { RodaliesLineGeometry } from '../../types/rodalies';
import type { PreprocessedRailwayLine } from '../trains/geometry';
import { preprocessRailwayLine } from '../trains/geometry';
import { loadAllTramLines } from '../metro/dataLoader';
import {
  TRAM_LINE_CONFIG,
  getTramLineCodes,
  calculateTramsPerDirection,
} from '../../config/tramConfig';
import { createPositionSimulator } from '../transit/positionSimulatorFactory';

// ============================================================================
// Internal: Bulk Line Loading (TRAM loads all lines at once)
// ============================================================================

/** Cache for preprocessed railway lines */
const preprocessedLineCache = new Map<string, PreprocessedRailwayLine>();

/** Cache for all tram lines collection */
let allTramLinesPromise: Promise<MetroLineCollection> | null = null;

/**
 * Load and preprocess a tram line geometry.
 * Uses bulk loading since TRAM data comes as a single collection.
 */
async function loadPreprocessedLine(lineCode: string): Promise<PreprocessedRailwayLine | null> {
  const cacheKey = lineCode.toUpperCase();

  if (preprocessedLineCache.has(cacheKey)) {
    return preprocessedLineCache.get(cacheKey)!;
  }

  try {
    // Load all tram lines and find the one we need
    if (!allTramLinesPromise) {
      allTramLinesPromise = loadAllTramLines();
    }
    const allLines = await allTramLinesPromise;

    // Find feature matching this line code
    const feature = allLines.features.find((f) => f.properties.line_code === lineCode);

    if (!feature) {
      console.warn(`[TramSimulator] No geometry found for tram line ${lineCode}`);
      return null;
    }

    // Cast to RodaliesLineGeometry for preprocessRailwayLine compatibility
    const geometry = feature.geometry as RodaliesLineGeometry;
    const preprocessed = preprocessRailwayLine(geometry);

    if (preprocessed) {
      preprocessed.lineId = lineCode;
      preprocessedLineCache.set(cacheKey, preprocessed);
    }

    return preprocessed;
  } catch (error) {
    console.error(`[TramSimulator] Failed to load/preprocess tram line ${lineCode}:`, error);
    return null;
  }
}

// ============================================================================
// Create Simulator Instance
// ============================================================================

const tramSimulator = createPositionSimulator(
  {
    networkType: 'tram',
    vehicleKeyPrefix: 'tram',
    routeIdPrefix: 'tram',
    confidence: 'medium',
    logPrefix: '[TramSimulator]',
  },
  {
    getLineCodes: getTramLineCodes,
    getLineConfig: (lineCode) => TRAM_LINE_CONFIG[lineCode],
    calculateVehiclesPerDirection: calculateTramsPerDirection,
    loadPreprocessedLine,
  }
  // No stop tracking for Tram
);

// ============================================================================
// Exports (maintain backward compatibility)
// ============================================================================

/**
 * Generate simulated vehicle positions for a single tram line
 */
export function generateLinePositions(
  lineCode: string,
  currentTimeMs: number
): Promise<VehiclePosition[]> {
  return tramSimulator.generateLinePositions(lineCode, currentTimeMs);
}

/**
 * Generate simulated positions for all configured tram lines
 */
export function generateAllTramPositions(currentTimeMs: number): Promise<VehiclePosition[]> {
  return tramSimulator.generateAllPositions(currentTimeMs);
}

/**
 * Preload all tram line geometries for faster position generation
 */
export function preloadTramGeometries(): Promise<void> {
  return tramSimulator.preloadGeometries();
}

/**
 * Clear the preprocessed line cache
 */
export function clearTramSimulatorCache(): void {
  tramSimulator.clearCache();
  preprocessedLineCache.clear();
  allTramLinesPromise = null;
}

/**
 * Get a preprocessed TRAM line geometry by line code
 * Returns null if not yet loaded
 */
export function getPreprocessedTramLine(lineCode: string): PreprocessedRailwayLine | null {
  return tramSimulator.getPreprocessedLine(lineCode);
}
