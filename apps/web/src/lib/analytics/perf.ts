/**
 * Performance tracking utilities for MiniBarcelona3D map application
 *
 * Tracks key metrics:
 * - Initial render timing (time to interactive)
 * - Geometry load timing (GeoJSON parsing and rendering)
 * - Map tile load timing
 * - Memory usage (optional)
 *
 * Usage:
 * ```ts
 * import { startMetric, endMetric, getMetrics } from '@/lib/analytics/perf';
 *
 * startMetric('map-render');
 * // ... render map
 * endMetric('map-render');
 *
 * console.log(getMetrics());
 * ```
 */

export interface PerformanceMetric {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface PerformanceBudget {
  name: string;
  threshold: number; // milliseconds
  warnThreshold?: number; // optional warning threshold
}

// Performance budgets for key metrics
export const PERFORMANCE_BUDGETS: PerformanceBudget[] = [
  { name: 'initial-render', threshold: 3000, warnThreshold: 2000 }, // 3s max, warn at 2s
  { name: 'geometry-load', threshold: 2000, warnThreshold: 1500 }, // 2s max, warn at 1.5s
  { name: 'map-tiles-load', threshold: 5000, warnThreshold: 3000 }, // 5s max, warn at 3s
  { name: 'legend-render', threshold: 500, warnThreshold: 300 }, // 500ms max, warn at 300ms
  { name: 'line-highlight', threshold: 200, warnThreshold: 100 }, // 200ms max, warn at 100ms
];

// In-memory storage for metrics
const metrics = new Map<string, PerformanceMetric>();
const completedMetrics: PerformanceMetric[] = [];

/**
 * Start tracking a performance metric
 */
export function startMetric(name: string, metadata?: Record<string, unknown>): void {
  const startTime = performance.now();

  metrics.set(name, {
    name,
    startTime,
    metadata,
  });

  // Also mark using Performance API for browser DevTools
  if (typeof performance !== 'undefined' && performance.mark) {
    performance.mark(`${name}-start`);
  }
}

/**
 * End tracking a performance metric
 */
export function endMetric(name: string, metadata?: Record<string, unknown>): void {
  const endTime = performance.now();
  const metric = metrics.get(name);

  if (!metric) {
    console.warn(`Performance metric "${name}" was not started`);
    return;
  }

  const duration = endTime - metric.startTime;
  const completedMetric: PerformanceMetric = {
    ...metric,
    endTime,
    duration,
    metadata: { ...metric.metadata, ...metadata },
  };

  completedMetrics.push(completedMetric);
  metrics.delete(name);

  // Mark end and measure using Performance API
  if (typeof performance !== 'undefined') {
    if (performance.mark) {
      performance.mark(`${name}-end`);
    }
    if (performance.measure) {
      try {
        performance.measure(name, `${name}-start`, `${name}-end`);
      } catch {
        // Marks might not exist if page was refreshed
      }
    }
  }

  // Check against budget
  const budget = PERFORMANCE_BUDGETS.find((b) => b.name === name);
  if (budget) {
    if (duration > budget.threshold) {
      console.error(
        `⚠️ Performance budget exceeded for "${name}": ${duration.toFixed(2)}ms > ${budget.threshold}ms`,
      );
    } else if (budget.warnThreshold && duration > budget.warnThreshold) {
      console.warn(
        `⚡ Performance warning for "${name}": ${duration.toFixed(2)}ms > ${budget.warnThreshold}ms`,
      );
    }
  }

  // Log metric in development
  if (import.meta.env.DEV) {
    console.log(`📊 Metric "${name}": ${duration.toFixed(2)}ms`, completedMetric.metadata || '');
  }
}

/**
 * Get all completed metrics
 */
export function getMetrics(): PerformanceMetric[] {
  return [...completedMetrics];
}

/**
 * Get a specific metric by name (most recent if multiple)
 */
export function getMetric(name: string): PerformanceMetric | undefined {
  return completedMetrics.filter((m) => m.name === name).pop();
}

/**
 * Clear all metrics (useful for testing)
 */
export function clearMetrics(): void {
  metrics.clear();
  completedMetrics.length = 0;
}

/**
 * Get performance summary with budget violations
 */
export function getPerformanceSummary(): {
  metrics: PerformanceMetric[];
  violations: Array<{ metric: string; duration: number; threshold: number }>;
  warnings: Array<{ metric: string; duration: number; warnThreshold: number }>;
} {
  const violations: Array<{ metric: string; duration: number; threshold: number }> = [];
  const warnings: Array<{ metric: string; duration: number; warnThreshold: number }> = [];

  completedMetrics.forEach((metric) => {
    const budget = PERFORMANCE_BUDGETS.find((b) => b.name === metric.name);
    if (budget && metric.duration) {
      if (metric.duration > budget.threshold) {
        violations.push({
          metric: metric.name,
          duration: metric.duration,
          threshold: budget.threshold,
        });
      } else if (budget.warnThreshold && metric.duration > budget.warnThreshold) {
        warnings.push({
          metric: metric.name,
          duration: metric.duration,
          warnThreshold: budget.warnThreshold,
        });
      }
    }
  });

  return {
    metrics: getMetrics(),
    violations,
    warnings,
  };
}

/**
 * Record initial page load metrics using Navigation Timing API
 */
export function recordNavigationMetrics(): void {
  if (typeof window === 'undefined' || !window.performance || !window.performance.timing) {
    return;
  }

  // Wait for page load to complete
  if (document.readyState !== 'complete') {
    const handleLoad = () => {
      window.removeEventListener('load', handleLoad);
      recordNavigationMetrics();
    };
    window.addEventListener('load', handleLoad);
    return;
  }

  const timing = window.performance.timing;
  const navigationStart = timing.navigationStart;

  const pageMetrics = {
    'dns-lookup': timing.domainLookupEnd - timing.domainLookupStart,
    'tcp-connect': timing.connectEnd - timing.connectStart,
    'request': timing.responseStart - timing.requestStart,
    'response': timing.responseEnd - timing.responseStart,
    'dom-processing': timing.domComplete - timing.domLoading,
    'page-load': timing.loadEventEnd - navigationStart,
  };

  Object.entries(pageMetrics).forEach(([name, duration]) => {
    if (duration >= 0) {
      completedMetrics.push({
        name,
        startTime: 0,
        endTime: duration,
        duration,
        metadata: { type: 'navigation' },
      });
    }
  });

  if (import.meta.env.DEV) {
    console.log('📈 Navigation metrics recorded:', pageMetrics);
  }
}

// Auto-record navigation metrics in browser
if (typeof window !== 'undefined') {
  recordNavigationMetrics();
}
