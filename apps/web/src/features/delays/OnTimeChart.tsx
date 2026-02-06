import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DelayHourlyStat } from '../../lib/api/delays';

interface OnTimeChartProps {
  hourlyStats: DelayHourlyStat[];
  hours: number;
}

interface HourlyPoint {
  hour: string;
  onTimePercent: number;
}

export function OnTimeChart({ hourlyStats, hours }: OnTimeChartProps) {
  const { t } = useTranslation('delays');

  // Aggregate all routes into overall on-time % per hour bucket
  const points = useMemo(() => {
    const byHour = new Map<string, { onTimeSum: number; count: number }>();

    for (const stat of hourlyStats) {
      const existing = byHour.get(stat.hourBucket) ?? { onTimeSum: 0, count: 0 };
      existing.onTimeSum += stat.onTimePercent;
      existing.count += 1;
      byHour.set(stat.hourBucket, existing);
    }

    const pts: HourlyPoint[] = [];
    for (const [hour, data] of byHour) {
      pts.push({
        hour,
        onTimePercent: data.count > 0 ? data.onTimeSum / data.count : 100,
      });
    }

    return pts.sort((a, b) => a.hour.localeCompare(b.hour));
  }, [hourlyStats]);

  if (points.length < 2) {
    return null;
  }

  // SVG dimensions
  const width = 600;
  const height = 120;
  const padLeft = 40;
  const padRight = 10;
  const padTop = 10;
  const padBottom = 25;

  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;

  // Scale: y from 0-100%, x evenly spaced
  const xStep = chartWidth / (points.length - 1);
  const yScale = (pct: number) => padTop + chartHeight - (pct / 100) * chartHeight;

  // Build polyline points
  const polylinePoints = points
    .map((p, i) => `${padLeft + i * xStep},${yScale(p.onTimePercent)}`)
    .join(' ');

  // Build area polygon (fill under line)
  const areaPoints = [
    `${padLeft},${padTop + chartHeight}`,
    ...points.map((p, i) => `${padLeft + i * xStep},${yScale(p.onTimePercent)}`),
    `${padLeft + (points.length - 1) * xStep},${padTop + chartHeight}`,
  ].join(' ');

  // Y-axis labels
  const yLabels = [0, 50, 100];

  // X-axis labels (show first, middle, last hour)
  const formatHour = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso.slice(11, 16);
    }
  };

  const xLabelIndices = [0, Math.floor(points.length / 2), points.length - 1];

  return (
    <Card className="bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('chart.title', { hours })}</CardTitle>
      </CardHeader>
      <CardContent>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          {/* Grid lines */}
          {yLabels.map((pct) => (
            <g key={pct}>
              <line
                x1={padLeft}
                y1={yScale(pct)}
                x2={width - padRight}
                y2={yScale(pct)}
                stroke="currentColor"
                strokeOpacity={0.1}
                strokeDasharray="4,4"
              />
              <text
                x={padLeft - 5}
                y={yScale(pct) + 3}
                textAnchor="end"
                className="fill-muted-foreground"
                fontSize={9}
              >
                {pct}%
              </text>
            </g>
          ))}

          {/* 90% threshold line */}
          <line
            x1={padLeft}
            y1={yScale(90)}
            x2={width - padRight}
            y2={yScale(90)}
            stroke="#22c55e"
            strokeOpacity={0.3}
            strokeDasharray="2,2"
          />

          {/* Area fill */}
          <polygon
            points={areaPoints}
            fill="url(#onTimeGradient)"
            opacity={0.3}
          />

          {/* Line */}
          <polyline
            points={polylinePoints}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={2}
            strokeLinejoin="round"
          />

          {/* Data points */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={padLeft + i * xStep}
              cy={yScale(p.onTimePercent)}
              r={2.5}
              fill={p.onTimePercent >= 90 ? '#22c55e' : p.onTimePercent >= 70 ? '#eab308' : '#ef4444'}
            />
          ))}

          {/* X-axis labels */}
          {xLabelIndices.map((idx) => (
            <text
              key={idx}
              x={padLeft + idx * xStep}
              y={height - 5}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={9}
            >
              {formatHour(points[idx].hour)}
            </text>
          ))}

          {/* Gradient definition */}
          <defs>
            <linearGradient id="onTimeGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
        </svg>
      </CardContent>
    </Card>
  );
}
