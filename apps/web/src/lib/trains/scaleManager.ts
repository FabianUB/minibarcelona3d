import type { IScaleManager, ScaleConfig, ScaleCacheStats } from '../../../../specs/003-train-line-colors-zoom/contracts/train-color-config';

interface ZoomScaleBucket {
  minZoom: number;
  maxZoom: number;
  scale: number;
}

export class ScaleManager implements IScaleManager {
  private config: ScaleConfig;
  private scaleCache: Map<number, number>;
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private zoomBuckets: ZoomScaleBucket[];

  constructor(config?: Partial<ScaleConfig>) {
    this.config = {
      minHeightPx: config?.minHeightPx ?? 15,
      maxHeightPx: config?.maxHeightPx ?? 50,
      targetHeightPx: config?.targetHeightPx ?? 30,
      referenceZoom: config?.referenceZoom ?? 11,
      zoomBucketSize: config?.zoomBucketSize ?? 0.1,
    };
    this.scaleCache = new Map();

    this.zoomBuckets = [
      { minZoom: 0, maxZoom: 15, scale: 1.0 },
      { minZoom: 15, maxZoom: 100, scale: 0.5 },
    ];
  }

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

  private quantizeZoom(zoom: number): number {
    return Math.round(zoom / this.config.zoomBucketSize) * this.config.zoomBucketSize;
  }

  invalidateCache(): void {
    this.scaleCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

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
