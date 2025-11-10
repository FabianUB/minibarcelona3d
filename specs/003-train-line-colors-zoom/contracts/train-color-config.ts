/**
 * Type Definitions: Enhanced Train Spatial Separation and Zoom-Responsive Sizing
 *
 * This file defines TypeScript interfaces and types for the train visualization system.
 * These are design contracts, not runtime code.
 *
 * PRIORITIES:
 * - P1 (Primary): Zoom-responsive scaling and spatial separation
 * - P2 (Secondary): Hover outline with line color
 */

import type * as THREE from 'three';
import type { RodaliesLine } from '../../../apps/web/src/types/rodalies';

// ============================================================================
// PRIMARY (P1): Zoom-Responsive Scale System
// ============================================================================

/**
 * ScaleConfig
 *
 * Configuration for zoom-responsive train scaling.
 * Maintains consistent screen-space size (12-40px) across all zoom levels.
 */
export interface ScaleConfig {
  /** Minimum screen-space height in pixels (default: 12) */
  minHeightPx: number;

  /** Maximum screen-space height in pixels (default: 40) */
  maxHeightPx: number;

  /** Target screen-space height at reference zoom (default: 25) */
  targetHeightPx: number;

  /** Reference zoom level for calibration (default: 10) */
  referenceZoom: number;

  /** Zoom quantization for caching (default: 0.1) */
  zoomBucketSize: number;
}

/**
 * IScaleManager
 *
 * Interface for zoom-responsive scale computation.
 * Uses exponential zoom compensation with caching.
 */
export interface IScaleManager {
  /**
   * Compute scale multiplier for current zoom level
   * @param zoom - Current map zoom level (5-17 typical range)
   * @returns Scale multiplier [0.48 - 1.6] range
   */
  computeScale(zoom: number): number;

  /**
   * Invalidate cache (force recomputation on next call)
   * Use when config changes or for manual cache control
   */
  invalidateCache(): void;

  /**
   * Get cache statistics for performance monitoring
   * @returns Cache hit/miss stats
   */
  getCacheStats(): ScaleCacheStats;
}

/**
 * ScaleCacheStats
 *
 * Performance statistics for scale caching.
 */
export interface ScaleCacheStats {
  /** Number of cache entries */
  size: number;

  /** Number of cache hits */
  hits: number;

  /** Number of cache misses */
  misses: number;

  /** Hit rate (0-1) */
  hitRate: number;
}

/**
 * ScaleComputationResult
 *
 * Result of scale computation for validation.
 */
export interface ScaleComputationResult {
  /** Computed scale multiplier */
  scale: number;

  /** Whether result came from cache */
  fromCache: boolean;

  /** Quantized zoom bucket used */
  zoomBucket: number;

  /** Whether scale was clamped to min/max */
  clamped: boolean;
}

// ============================================================================
// PRIMARY (P1): Spatial Separation System
// ============================================================================

/**
 * LateralOffsetConfig
 *
 * Configuration for spatial separation of co-located trains.
 * Enhances visibility at high zoom levels (>14).
 */
export interface LateralOffsetConfig {
  /** Number of offset positions (default: 5) */
  buckets: number;

  /** Base offset distance in meters (default: 1.6) */
  baseStepMeters: number;

  /** Zoom level threshold for increased offset (default: 14) */
  highZoomThreshold: number;

  /** Offset multiplier at high zoom (default: 1.5) */
  highZoomMultiplier: number;
}

/**
 * LateralOffsetResult
 *
 * Result of lateral offset computation.
 */
export interface LateralOffsetResult {
  /** Offset distance in meters */
  offsetMeters: number;

  /** Offset index [0-4] */
  offsetIndex: number;

  /** Whether high zoom multiplier was applied */
  highZoomApplied: boolean;

  /** Current zoom level */
  zoom: number;
}

// ============================================================================
// SECONDARY (P2): Hover Outline System
// ============================================================================

/**
 * OutlineConfig
 *
 * Configuration for hover outline system (lazy-loaded, optional).
 * Shows line brand color when hovering over trains.
 */
export interface OutlineConfig {
  /** Outline scale factor relative to base mesh (default: 1.05 = 5% larger) */
  scaleFactor: number;

  /** Outline opacity (default: 0.8) */
  opacity: number;

  /** Fallback color hex for unmapped routes (default: "CCCCCC") */
  fallbackColor: string;
}

/**
 * OutlineMeshData
 *
 * Data structure for hover outline mesh.
 * Created lazily on first hover for memory optimization.
 */
export interface OutlineMeshData {
  /** Container for outline meshes (duplicate geometry) */
  outlineGroup: THREE.Group;

  /** Line color from RodaliesLine data */
  lineColor: THREE.Color;

  /** Current visibility state */
  visible: boolean;
}

/**
 * IOutlineManager (Optional)
 *
 * Interface for hover outline creation and management.
 * May be implemented if outline system needs isolation.
 */
export interface IOutlineManager {
  /**
   * Create outline mesh for a train (lazy initialization)
   * @param trainMesh - Base train mesh
   * @param lineColor - Line brand color
   * @returns Outline mesh group
   */
  createOutline(trainMesh: THREE.Group, lineColor: THREE.Color): THREE.Group;

  /**
   * Show outline for a train
   * @param vehicleKey - Train identifier
   */
  showOutline(vehicleKey: string): void;

  /**
   * Hide outline for a train
   * @param vehicleKey - Train identifier
   */
  hideOutline(vehicleKey: string): void;

  /**
   * Cleanup outline mesh
   * @param vehicleKey - Train identifier
   */
  removeOutline(vehicleKey: string): void;
}

// ============================================================================
// Integrated Configuration
// ============================================================================

/**
 * TrainVisualConfig
 *
 * Complete configuration for train visual enhancements.
 * Combines P1 (scale + offset) and P2 (outline) systems.
 */
export interface TrainVisualConfig {
  /** PRIMARY: Zoom-responsive scale configuration */
  scaleConfig: ScaleConfig;

  /** PRIMARY: Lateral offset configuration */
  lateralOffsetConfig: LateralOffsetConfig;

  /** SECONDARY: Hover outline configuration (optional) */
  outlineConfig?: OutlineConfig;
}

/**
 * TrainVisualState
 *
 * Complete visual state for a single train.
 * Stored in TrainMeshData for per-train tracking.
 */
export interface TrainVisualState {
  /** PRIMARY: Current zoom-responsive scale multiplier */
  screenSpaceScale: number;

  /** PRIMARY: Last quantized zoom level (for cache invalidation) */
  lastZoomBucket: number;

  /** PRIMARY: Current lateral offset in meters */
  lateralOffsetMeters: number;

  /** PRIMARY: Lateral offset bucket index [0-4] */
  lateralOffsetIndex: number;

  /** SECONDARY: Line code extracted from route ID (lazy) */
  lineCode?: string;

  /** SECONDARY: Applied line color (lazy, for outline) */
  lineColor?: THREE.Color;

  /** SECONDARY: Outline mesh group (lazy-created on first hover) */
  outlineMesh?: THREE.Group;
}

/**
 * TrainVisualUpdateParams
 *
 * Parameters for updating train visual properties.
 * Passed to TrainMeshManager render loop.
 */
export interface TrainVisualUpdateParams {
  /** Current map zoom level */
  zoom: number;

  /** Whether to force scale recomputation (cache invalidation) */
  forceScaleUpdate?: boolean;

  /** Whether to force offset recomputation */
  forceOffsetUpdate?: boolean;
}

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Default scale configuration (P1)
 * Based on research.md findings for 12-40px screen-space height.
 */
export const DEFAULT_SCALE_CONFIG: ScaleConfig = {
  minHeightPx: 12,
  maxHeightPx: 40,
  targetHeightPx: 25,
  referenceZoom: 10,
  zoomBucketSize: 0.1,
};

/**
 * Default lateral offset configuration (P1)
 * Based on research.md findings for zoom-responsive separation.
 */
export const DEFAULT_LATERAL_OFFSET_CONFIG: LateralOffsetConfig = {
  buckets: 5,
  baseStepMeters: 1.6,
  highZoomThreshold: 14,
  highZoomMultiplier: 1.5,
};

/**
 * Default outline configuration (P2)
 * Lazy-loaded system for hover outline effect.
 */
export const DEFAULT_OUTLINE_CONFIG: OutlineConfig = {
  scaleFactor: 1.05,
  opacity: 0.8,
  fallbackColor: 'CCCCCC',
};

/**
 * Get default complete visual configuration
 */
export function getDefaultTrainVisualConfig(): TrainVisualConfig {
  return {
    scaleConfig: DEFAULT_SCALE_CONFIG,
    lateralOffsetConfig: DEFAULT_LATERAL_OFFSET_CONFIG,
    outlineConfig: DEFAULT_OUTLINE_CONFIG,
  };
}

// ============================================================================
// Validation & Error Types
// ============================================================================

/**
 * TrainVisualConfigError
 *
 * Error thrown when visual configuration validation fails.
 */
export class TrainVisualConfigError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown
  ) {
    super(`TrainVisualConfig validation failed: ${message}`);
    this.name = 'TrainVisualConfigError';
  }
}

/**
 * Validation functions for runtime type checking
 */
export interface ITrainVisualConfigValidator {
  validateScaleConfig(config: ScaleConfig): void;
  validateLateralOffsetConfig(config: LateralOffsetConfig): void;
  validateOutlineConfig(config: OutlineConfig): void;
  validateTrainVisualConfig(config: TrainVisualConfig): void;
}

// ============================================================================
// Helper Types for Line Color Lookup (P2)
// ============================================================================

/**
 * LineColorMap
 *
 * Simple mapping from line code to THREE.Color.
 * Used for hover outline color lookup.
 */
export type LineColorMap = Map<string, THREE.Color>;

/**
 * LineColorLookup
 *
 * Utility function type for extracting line code and getting color.
 */
export type LineColorLookup = (routeId: string) => THREE.Color;

/**
 * buildLineColorMap
 *
 * Helper to create color map from RodaliesLine data.
 * @param lines - Array of line definitions
 * @param fallbackColor - Color for unmapped routes
 * @returns Map from line code to THREE.Color
 */
export function buildLineColorMap(
  lines: RodaliesLine[],
  fallbackColor: string = 'CCCCCC'
): LineColorMap {
  const map = new Map<string, THREE.Color>();

  for (const line of lines) {
    const color = new THREE.Color(`#${line.brand_color}`);
    map.set(line.short_code.toUpperCase(), color);
  }

  // Add fallback
  map.set('__FALLBACK__', new THREE.Color(`#${fallbackColor}`));

  return map;
}
