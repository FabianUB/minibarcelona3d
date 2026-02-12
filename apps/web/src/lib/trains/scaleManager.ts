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
 * Discrete zoom range with associated scale multiplier
 */
interface ZoomScaleBucket {
  /** Minimum zoom level (inclusive) */
  minZoom: number;
  /** Maximum zoom level (exclusive) */
  maxZoom: number;
  /** Scale multiplier to apply within this zoom range */
  scale: number;
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
  private zoomBuckets: ZoomScaleBucket[];

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

    // Discrete zoom buckets for simplified scale computation
    // Zoom 0-15.5: Reduced size (0.7x) to match visual proportion at zoom 15
    // Zoom 15.5+: Further reduced (0.5x) to prevent trains becoming too large
    this.zoomBuckets = [
      { minZoom: 0, maxZoom: 15.5, scale: 0.7 },
      { minZoom: 15.5, maxZoom: 100, scale: 0.5 },
    ];
  }

  /**
   * Compute scale multiplier for given zoom level
   *
   * Uses discrete zoom buckets to determine appropriate scale. Results are cached
   * using quantized zoom levels to maximize cache hits during map interactions.
   *
   * @param zoom - Current map zoom level
   * @returns Scale multiplier (applied to base mesh scale)
   *
   * @example
   * ```typescript
   * const scale = scaleManager.computeScale(14.0); // Returns 1.0
   * const scale2 = scaleManager.computeScale(16.5); // Returns 0.5
   * ```
   */
  computeScale(zoom: number): number {
    const zoomBucket = this.quantizeZoom(zoom);

    const cached = this.scaleCache.get(zoomBucket);
    if (cached !== undefined) {
      this.cacheHits++;
      return cached;
    }

    this.cacheMisses++;

    const bucket = this.zoomBuckets.find(
      b => zoom >= b.minZoom && zoom < b.maxZoom
    );

    const scale = bucket ? bucket.scale : 0.6;

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
