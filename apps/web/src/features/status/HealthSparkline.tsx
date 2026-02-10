/**
 * HealthSparkline Component
 *
 * A small SVG sparkline chart showing health score history over time.
 * Designed to be embedded in the status page network cards.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchHealthHistory,
  type HealthHistoryPoint,
  type HealthStatus,
} from '../../lib/api/health';

interface HealthSparklineProps {
  /** Network to show history for, or 'overall' */
  network: string;
  /** Width of the sparkline in pixels */
  width?: number;
  /** Height of the sparkline in pixels */
  height?: number;
  /** Number of hours of history to fetch */
  hours?: number;
  /** How often to refresh (ms). Default: 60000 (1 min) */
  refreshInterval?: number;
}

export function HealthSparkline({
  network,
  width = 120,
  height = 32,
  hours = 2,
  refreshInterval = 60000,
}: HealthSparklineProps) {
  const { t } = useTranslation('status');
  const [points, setPoints] = useState<HealthHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetchHealthHistory(network, hours);
      setPoints(response.points);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [network, hours]);

  useEffect(() => {
    loadHistory();
    const interval = setInterval(loadHistory, refreshInterval);
    return () => clearInterval(interval);
  }, [loadHistory, refreshInterval]);

  // Calculate SVG path from points
  const { path, gradientId, statusColor, minScore, maxScore, currentScore } = useMemo(() => {
    if (points.length === 0) {
      return {
        path: '',
        gradientId: `sparkline-${network}`,
        statusColor: '#6b7280',
        minScore: 0,
        maxScore: 100,
        currentScore: 0,
      };
    }

    const padding = 2;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    // Get score range (with some padding)
    const scores = points.map((p) => p.healthScore);
    const min = Math.max(0, Math.min(...scores) - 10);
    const max = Math.min(100, Math.max(...scores) + 10);
    const range = max - min || 1;

    // Build SVG path
    const pathData = points
      .map((point, index) => {
        const x = padding + (index / (points.length - 1)) * chartWidth;
        const y = padding + chartHeight - ((point.healthScore - min) / range) * chartHeight;
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

    // Determine color based on current status
    const currentStatus = points[points.length - 1]?.status || 'unknown';
    const colors: Record<HealthStatus | 'unknown', string> = {
      healthy: '#22c55e',
      degraded: '#eab308',
      unhealthy: '#ef4444',
      unknown: '#6b7280',
    };

    return {
      path: pathData,
      gradientId: `sparkline-gradient-${network}`,
      statusColor: colors[currentStatus as HealthStatus] || colors.unknown,
      minScore: Math.min(...scores),
      maxScore: Math.max(...scores),
      currentScore: points[points.length - 1]?.healthScore || 0,
    };
  }, [points, width, height, network]);

  // Build area path for gradient fill
  const areaPath = useMemo(() => {
    if (points.length === 0) return '';

    const padding = 2;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const scores = points.map((p) => p.healthScore);
    const min = Math.max(0, Math.min(...scores) - 10);
    const max = Math.min(100, Math.max(...scores) + 10);
    const range = max - min || 1;

    // Start from bottom-left
    let d = `M ${padding} ${padding + chartHeight}`;

    // Line to first point
    points.forEach((point, index) => {
      const x = padding + (index / (points.length - 1)) * chartWidth;
      const y = padding + chartHeight - ((point.healthScore - min) / range) * chartHeight;
      d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    });

    // Line to bottom-right and close
    d += ` L ${padding + chartWidth} ${padding + chartHeight} Z`;

    return d;
  }, [points, width, height]);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center bg-muted/30 rounded"
        style={{ width, height }}
      >
        <div className="w-3 h-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (error || points.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground bg-muted/30 rounded"
        style={{ width, height }}
      >
        {t('sparkline.noData')}
      </div>
    );
  }

  return (
    <div className="relative group" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        className="overflow-visible"
        aria-label={t('sparkline.ariaLabel', { network, score: currentScore })}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={statusColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={statusColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Area fill */}
        <path d={areaPath} fill={`url(#${gradientId})`} />

        {/* Line */}
        <path
          d={path}
          fill="none"
          stroke={statusColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Current value dot */}
        {points.length > 0 && (
          <circle
            cx={width - 2}
            cy={
              2 +
              (height - 4) -
              ((currentScore - Math.max(0, minScore - 10)) /
                (Math.min(100, maxScore + 10) - Math.max(0, minScore - 10) || 1)) *
                (height - 4)
            }
            r="2.5"
            fill={statusColor}
            className="animate-pulse"
          />
        )}
      </svg>

      {/* Tooltip on hover */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-popover text-popover-foreground text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
        {minScore === maxScore
          ? t('sparkline.stable', { score: currentScore })
          : t('sparkline.range', { min: minScore, max: maxScore, current: currentScore })}
      </div>
    </div>
  );
}
