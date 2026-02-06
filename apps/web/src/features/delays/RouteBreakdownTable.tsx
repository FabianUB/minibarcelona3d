import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DelayHourlyStat } from '../../lib/api/delays';

interface RouteBreakdownTableProps {
  hourlyStats: DelayHourlyStat[];
}

interface RouteAggregate {
  routeId: string;
  totalObservations: number;
  avgDelay: number;
  onTimePercent: number;
  maxDelay: number;
}

export function RouteBreakdownTable({ hourlyStats }: RouteBreakdownTableProps) {
  const { t } = useTranslation('delays');

  // Aggregate stats by route
  const routeAggregates = useMemo(() => {
    const byRoute = new Map<string, { totalObs: number; delaySum: number; onTimeSum: number; onTimeCount: number; maxDelay: number }>();

    for (const stat of hourlyStats) {
      const existing = byRoute.get(stat.routeId) ?? { totalObs: 0, delaySum: 0, onTimeSum: 0, onTimeCount: 0, maxDelay: 0 };
      existing.totalObs += stat.observationCount;
      existing.delaySum += stat.meanDelaySeconds * stat.observationCount;
      existing.onTimeSum += stat.onTimePercent;
      existing.onTimeCount += 1;
      existing.maxDelay = Math.max(existing.maxDelay, stat.maxDelaySeconds);
      byRoute.set(stat.routeId, existing);
    }

    const aggregates: RouteAggregate[] = [];
    for (const [routeId, data] of byRoute) {
      aggregates.push({
        routeId,
        totalObservations: data.totalObs,
        avgDelay: data.totalObs > 0 ? data.delaySum / data.totalObs : 0,
        onTimePercent: data.onTimeCount > 0 ? data.onTimeSum / data.onTimeCount : 100,
        maxDelay: data.maxDelay,
      });
    }

    // Sort by worst on-time percentage first
    return aggregates.sort((a, b) => a.onTimePercent - b.onTimePercent);
  }, [hourlyStats]);

  if (routeAggregates.length === 0) {
    return null;
  }

  const formatDelay = (seconds: number): string => {
    const absSeconds = Math.abs(seconds);
    if (absSeconds < 60) return `${Math.round(seconds)}s`;
    return `${(seconds / 60).toFixed(1)}m`;
  };

  const getOnTimeColor = (pct: number): string => {
    if (pct >= 90) return 'text-green-500';
    if (pct >= 70) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <Card className="bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('routes.title')}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('routes.route')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('routes.observations')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('routes.avgDelay')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('routes.onTime')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('routes.maxDelay')}</th>
              </tr>
            </thead>
            <tbody>
              {routeAggregates.map((route) => (
                <tr key={route.routeId} className="border-b">
                  <td className="px-3 py-2 font-medium">{route.routeId}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{route.totalObservations}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{formatDelay(route.avgDelay)}</td>
                  <td className={`px-3 py-2 text-right font-mono text-xs font-bold ${getOnTimeColor(route.onTimePercent)}`}>
                    {route.onTimePercent.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{formatDelay(route.maxDelay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
