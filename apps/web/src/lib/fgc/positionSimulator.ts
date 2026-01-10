/**
 * FGC Position Simulator
 *
 * Generates simulated train positions for FGC (Ferrocarrils de la Generalitat)
 * based on schedule data (headway, average speed) rather than real-time GPS.
 *
 * Uses the unified position simulator factory.
 */

import type { VehiclePosition } from '../../types/transit';
import type { MetroLineCollection } from '../../types/metro';
import type { RodaliesLineGeometry } from '../../types/rodalies';
import type { PreprocessedRailwayLine } from '../trains/geometry';
import { preprocessRailwayLine } from '../trains/geometry';
import { loadAllFgcLines } from '../metro/dataLoader';
import {
  FGC_LINE_CONFIG,
  getFgcLineCodes,
  calculateFgcTrainsPerDirection,
} from '../../config/fgcConfig';
import { createPositionSimulator } from '../transit/positionSimulatorFactory';

// ============================================================================
// Internal: Bulk Line Loading (FGC loads all lines at once)
// ============================================================================

/** Cache for preprocessed railway lines */
const preprocessedLineCache = new Map<string, PreprocessedRailwayLine>();

/** Cache for all FGC lines collection */
let allFgcLinesPromise: Promise<MetroLineCollection> | null = null;

/**
 * Load and preprocess an FGC line geometry.
 * Uses bulk loading since FGC data comes as a single collection.
 */
async function loadPreprocessedLine(lineCode: string): Promise<PreprocessedRailwayLine | null> {
  const cacheKey = lineCode.toUpperCase();

  if (preprocessedLineCache.has(cacheKey)) {
    return preprocessedLineCache.get(cacheKey)!;
  }

  try {
    // Load all FGC lines and find the one we need
    if (!allFgcLinesPromise) {
      allFgcLinesPromise = loadAllFgcLines();
    }
    const allLines = await allFgcLinesPromise;

    // Find feature matching this line code
    const feature = allLines.features.find((f) => f.properties.line_code === lineCode);

    if (!feature) {
      console.warn(`[FgcSimulator] No geometry found for FGC line ${lineCode}`);
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
    console.error(`[FgcSimulator] Failed to load/preprocess FGC line ${lineCode}:`, error);
    return null;
  }
}

// ============================================================================
// Create Simulator Instance
// ============================================================================

const fgcSimulator = createPositionSimulator(
  {
    networkType: 'fgc',
    vehicleKeyPrefix: 'fgc',
    routeIdPrefix: 'fgc',
    confidence: 'medium',
    logPrefix: '[FgcSimulator]',
  },
  {
    getLineCodes: getFgcLineCodes,
    getLineConfig: (lineCode) => FGC_LINE_CONFIG[lineCode],
    calculateVehiclesPerDirection: calculateFgcTrainsPerDirection,
    loadPreprocessedLine,
  }
  // No stop tracking for FGC
);

// ============================================================================
// Exports (maintain backward compatibility)
// ============================================================================

/**
 * Generate simulated vehicle positions for a single FGC line
 */
export function generateLinePositions(
  lineCode: string,
  currentTimeMs: number
): Promise<VehiclePosition[]> {
  return fgcSimulator.generateLinePositions(lineCode, currentTimeMs);
}

/**
 * Generate simulated positions for all configured FGC lines
 */
export function generateAllFgcPositions(currentTimeMs: number): Promise<VehiclePosition[]> {
  return fgcSimulator.generateAllPositions(currentTimeMs);
}

/**
 * Preload all FGC line geometries for faster position generation
 */
export function preloadFgcGeometries(): Promise<void> {
  return fgcSimulator.preloadGeometries();
}

/**
 * Clear the preprocessed line cache
 */
export function clearFgcSimulatorCache(): void {
  fgcSimulator.clearCache();
  preprocessedLineCache.clear();
  allFgcLinesPromise = null;
}

/**
 * Get a preprocessed FGC line geometry by line code
 * Returns null if not yet loaded
 */
export function getPreprocessedFgcLine(lineCode: string): PreprocessedRailwayLine | null {
  return fgcSimulator.getPreprocessedLine(lineCode);
}
