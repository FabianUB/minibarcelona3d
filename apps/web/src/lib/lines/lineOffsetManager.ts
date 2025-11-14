import type {
  LineStringGeometry,
  MultiLineStringGeometry,
  RodaliesLineGeometry,
} from '../../types/rodalies';
import { offsetLineString, offsetMultiLineString } from './geometryOffset';

/**
 * Configuration for line offset computation
 */
export interface LineOffsetConfig {
  lineId: string;
  offsetIndex: number; // -2, -1, 0, 1, 2 for multi-line groups
  zoom: number;
}

/**
 * Manages visual separation of overlapping railway lines through perpendicular offset
 *
 * Applies zoom-responsive offset to line geometries to create visual separation
 * between lines that run parallel or very close together on the map.
 */
export class LineOffsetManager {
  // Cache for offset geometries: Map<cacheKey, offsetGeometry>
  private geometryCache: Map<string, RodaliesLineGeometry> = new Map();

  // Line grouping configuration: which lines are grouped for offset
  private lineGroups: Map<string, number> = new Map();

  // Zoom bucket size for caching (in zoom levels)
  private readonly ZOOM_BUCKET_SIZE = 0.5;

  constructor() {
    this.initializeLineGroups();
  }

  /**
   * Initialize line grouping for known parallel/converging lines
   * Based on Barcelona Rodalies network topology
   */
  private initializeLineGroups(): void {
    // Lines that converge in Barcelona center area (adjust indices for better separation)
    // Assign offset indices: negative = left, 0 = center, positive = right
    this.lineGroups.set('R1', -2);
    this.lineGroups.set('R2', -1);
    this.lineGroups.set('R3', 0);
    this.lineGroups.set('R4', 1);
    this.lineGroups.set('R7', 2);

    // Additional lines (if they exist in your data)
    this.lineGroups.set('R8', -1);
    this.lineGroups.set('R11', 0);
    this.lineGroups.set('R12', 1);
  }

  /**
   * Compute offset distance in meters based on zoom level and offset index
   *
   * Zoom-dependent offset strategy (Solution 1 - revised):
   * - zoom < 12: 0m (no offset, natural position)
   * - zoom 12-14: 0-30m (gradually increase for nice line separation)
   * - zoom 14-16: 30-10m (gradually reduce but maintain some separation)
   * - zoom > 16: 10m (minimum offset to keep lines visually distinct)
   *
   * This ensures lines remain visually separated at all zoom levels while
   * keeping trains reasonably aligned with their lines.
   */
  public computeLineOffset(config: LineOffsetConfig): number {
    const { offsetIndex, zoom } = config;

    if (offsetIndex === 0) {
      return 0; // Center line stays at natural position
    }

    // Base offset per index unit (in meters)
    let baseOffset = 0;

    if (zoom < 12) {
      // Very low zoom: no offset needed
      baseOffset = 0;
    } else if (zoom < 14) {
      // Low-medium zoom: gradually increase offset for nice line separation
      const t = (zoom - 12) / 2;
      baseOffset = t * 30;
    } else if (zoom < 16) {
      // Medium-high zoom: reduce offset but keep lines separated
      const t = (zoom - 14) / 2;
      baseOffset = 30 - (t * 20); // Fade from 30m to 10m
    } else {
      // High zoom: minimum offset to keep lines visually distinct
      // This prevents lines from converging into one
      baseOffset = 10;
    }

    // Apply offset index multiplier (negative indices go left, positive go right)
    return baseOffset * offsetIndex;
  }

  /**
   * Get cache key for storing/retrieving offset geometry
   */
  private getCacheKey(lineId: string, zoom: number): string {
    const zoomBucket = Math.floor(zoom / this.ZOOM_BUCKET_SIZE) * this.ZOOM_BUCKET_SIZE;
    return `${lineId}_${zoomBucket.toFixed(1)}`;
  }

  /**
   * Apply offset to line geometry and cache result
   *
   * @param lineId - Line identifier (e.g., "R1", "R2")
   * @param geometry - Original line geometry
   * @param zoom - Current map zoom level
   * @returns Offset geometry (or original if no offset needed)
   */
  public applyOffset(
    lineId: string,
    geometry: RodaliesLineGeometry,
    zoom: number
  ): RodaliesLineGeometry {
    const offsetIndex = this.lineGroups.get(lineId) ?? 0;

    // Check cache first
    const cacheKey = this.getCacheKey(lineId, zoom);
    const cached = this.geometryCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Compute offset distance
    const offsetMeters = this.computeLineOffset({ lineId, offsetIndex, zoom });

    // No offset needed
    if (Math.abs(offsetMeters) < 0.1) {
      this.geometryCache.set(cacheKey, geometry);
      return geometry;
    }

    // Apply offset based on geometry type
    let offsetGeometry: RodaliesLineGeometry;

    if (geometry.type === 'LineString') {
      const offsetCoords = offsetLineString(geometry.coordinates, offsetMeters);
      offsetGeometry = {
        type: 'LineString',
        coordinates: offsetCoords,
      } as LineStringGeometry;
    } else {
      // MultiLineString
      const offsetCoords = offsetMultiLineString(geometry.coordinates, offsetMeters);
      offsetGeometry = {
        type: 'MultiLineString',
        coordinates: offsetCoords,
      } as MultiLineStringGeometry;
    }

    // Cache and return
    this.geometryCache.set(cacheKey, offsetGeometry);
    return offsetGeometry;
  }

  /**
   * Get cache statistics for debugging
   */
  public getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.geometryCache.size,
      keys: Array.from(this.geometryCache.keys()),
    };
  }

  /**
   * Clear geometry cache (useful for memory management)
   */
  public clearCache(): void {
    this.geometryCache.clear();
  }

  /**
   * Update line grouping configuration
   * Useful if you want to dynamically adjust which lines are grouped
   */
  public setLineGroup(lineId: string, offsetIndex: number): void {
    this.lineGroups.set(lineId, offsetIndex);
    // Invalidate cache entries for this line
    const keysToDelete: string[] = [];
    for (const key of this.geometryCache.keys()) {
      if (key.startsWith(`${lineId}_`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => this.geometryCache.delete(key));
  }
}
