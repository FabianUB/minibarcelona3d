/**
 * Configuration options for zoom-responsive train scaling
 */
export interface ScaleConfig {
  /** Minimum train height in screen pixels */
  minHeightPx: number;
  /** Maximum train height in screen pixels */
  maxHeightPx: number;
  /** Target train height in screen pixels at reference zoom */
  targetHeightPx: number;
  /** Zoom level used as baseline for scale calculations */
  referenceZoom: number;
  /** Zoom bucket size for cache quantization (e.g., 0.1 for 0.1 zoom increments) */
  zoomBucketSize: number;
}

/**
 * Statistics about scale computation cache performance
 */
export interface ScaleCacheStats {
  /** Number of zoom levels cached */
  size: number;
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Cache hit rate (0.0 to 1.0) */
  hitRate: number;
}

/**
 * Interface for scale computation with caching
 */
export interface IScaleManager {
  /** Compute scale multiplier for given zoom level */
  computeScale(zoom: number): number;
  /** Clear scale cache and reset statistics */
  invalidateCache(): void;
  /** Get current cache performance statistics */
  getCacheStats(): ScaleCacheStats;
}

/**
 * Manages zoom-responsive scaling for train meshes
 *
 * Uses discrete zoom buckets to ensure trains maintain appropriate screen-space size
 * across all zoom levels. Implements caching to minimize redundant scale calculations
 * during map interactions.
 *
 * @example
 * ```typescript
 * const scaleManager = new ScaleManager({
 *   minHeightPx: 15,
 *   maxHeightPx: 50,
 *   targetHeightPx: 30,
 * });
 *
 * const scale = scaleManager.computeScale(16.5);
 * mesh.scale.multiplyScalar(scale);
 *
 * const stats = scaleManager.getCacheStats();
 * console.log(`Cache hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
 * ```
 */
export class ScaleManager implements IScaleManager {
  private config: ScaleConfig;
  private scaleCache: Map<number, number>;
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  /**
   * Creates a new ScaleManager instance
   *
   * @param config - Partial configuration (unspecified values use defaults)
   * @default minHeightPx 15px
   * @default maxHeightPx 50px
   * @default targetHeightPx 30px
   * @default referenceZoom 11
   * @default zoomBucketSize 0.1
   */
  constructor(config?: Partial<ScaleConfig>) {
    this.config = {
      minHeightPx: config?.minHeightPx ?? 15,
      maxHeightPx: config?.maxHeightPx ?? 50,
      targetHeightPx: config?.targetHeightPx ?? 30,
      referenceZoom: config?.referenceZoom ?? 11,
      zoomBucketSize: config?.zoomBucketSize ?? 0.1,
    };
    this.scaleCache = new Map();
  }

  /**
   * Compute scale multiplier for given zoom level.
   *
   * Uses a continuous formula: partial (square-root) compensation for zoom
   * changes around a reference zoom of 14.  This keeps models visible when
   * zooming out while preventing them from dominating at close zoom.
   *
   * Clamped to [0.35, 3.0] and cached per 0.1-zoom increment.
   */
  computeScale(zoom: number): number {
    const zoomBucket = this.quantizeZoom(zoom);

    const cached = this.scaleCache.get(zoomBucket);
    if (cached !== undefined) {
      this.cacheHits++;
      return cached;
    }

    this.cacheMisses++;

    // 0.7 at reference zoom 14, grows/shrinks by sqrt(2) per zoom level
    const REFERENCE_ZOOM = 14;
    const REFERENCE_SCALE = 0.7;
    const raw = REFERENCE_SCALE * Math.pow(2, (REFERENCE_ZOOM - zoom) * 0.5);
    const scale = Math.max(0.35, Math.min(3.0, raw));

    this.scaleCache.set(zoomBucket, scale);
    return scale;
  }

  /**
   * Quantize zoom level to bucket size for cache key generation
   *
   * Rounds zoom to nearest bucket increment (e.g., 14.73 → 14.7 with 0.1 bucket size).
   * This ensures similar zoom levels share cache entries, improving hit rate.
   *
   * @param zoom - Raw zoom level
   * @returns Quantized zoom level
   * @private
   */
  private quantizeZoom(zoom: number): number {
    return Math.round(zoom / this.config.zoomBucketSize) * this.config.zoomBucketSize;
  }

  /**
   * Clear scale cache and reset performance statistics
   *
   * Should be called when zoom bucket configuration changes or when
   * memory needs to be freed.
   */
  invalidateCache(): void {
    this.scaleCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Get current cache performance statistics
   *
   * @returns Cache statistics including size, hits, misses, and hit rate
   *
   * @example
   * ```typescript
   * const stats = scaleManager.getCacheStats();
   * console.log(`Cache entries: ${stats.size}`);
   * console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
   * ```
   */
  getCacheStats(): ScaleCacheStats {
    const total = this.cacheHits + this.cacheMisses;
    return {
      size: this.scaleCache.size,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0,
    };
  }
}
