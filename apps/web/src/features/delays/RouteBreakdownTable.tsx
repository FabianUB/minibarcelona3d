import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DelayHourlyStat } from '../../lib/api/delays';

// Display order matching the legend panel
const ROUTE_ORDER: string[] = [
  'R1', 'R2', 'R2N', 'R2S', 'R3', 'R4', 'R8',
  'R11', 'R13', 'R14', 'R15', 'R16', 'R17', 'RT1',
];

// Brand colors from RodaliesLine.json
const RODALIES_LINE_COLORS: Record<string, string> = {
  R1: '#7DBCEC',
  R2: '#26A741',
  R2N: '#D0DF00',
  R2S: '#146520',
  R3: '#EB4128',
  R4: '#F7A30D',
  R8: '#88016A',
  R11: '#0069AA',
  R13: '#E52E87',
  R14: '#6C60A8',
  R15: '#978571',
  R16: '#B52B46',
  R17: '#F3B12E',
  RT1: '#35BDB2',
};

interface RouteBreakdownTableProps {
  hourlyStats: DelayHourlyStat[];
}

interface RouteAggregate {
  routeId: string;
  totalObservations: number;
  avgDelay: number;
  maxDelay: number;
}

export function RouteBreakdownTable({ hourlyStats }: RouteBreakdownTableProps) {
  const { t } = useTranslation('delays');

  const routeAggregates = useMemo(() => {
    // Seed every known route so all appear even with 0 observations
    const byRoute = new Map<string, { totalObs: number; delaySum: number; maxDelay: number }>();
    for (const routeId of ROUTE_ORDER) {
      byRoute.set(routeId, { totalObs: 0, delaySum: 0, maxDelay: 0 });
    }

    for (const stat of hourlyStats) {
      const existing = byRoute.get(stat.routeId) ?? { totalObs: 0, delaySum: 0, maxDelay: 0 };
      existing.totalObs += stat.observationCount;
      existing.delaySum += stat.meanDelaySeconds * stat.observationCount;
      existing.maxDelay = Math.max(existing.maxDelay, stat.maxDelaySeconds);
      byRoute.set(stat.routeId, existing);
    }

    const aggregates: RouteAggregate[] = [];
    for (const [routeId, data] of byRoute) {
      aggregates.push({
        routeId,
        totalObservations: data.totalObs,
        avgDelay: data.totalObs > 0 ? data.delaySum / data.totalObs : 0,
        maxDelay: data.maxDelay,
      });
    }

    // Sort by legend order
    return aggregates.sort((a, b) => {
      const idxA = ROUTE_ORDER.indexOf(a.routeId);
      const idxB = ROUTE_ORDER.indexOf(b.routeId);
      return (idxA === -1 ? ROUTE_ORDER.length : idxA) - (idxB === -1 ? ROUTE_ORDER.length : idxB);
    });
  }, [hourlyStats]);

  if (routeAggregates.length === 0) {
    return null;
  }

  const formatDelay = (seconds: number): string => {
    const absSeconds = Math.abs(seconds);
    if (absSeconds < 60) return `${Math.round(seconds)}s`;
    return `${(seconds / 60).toFixed(1)}m`;
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
                <th className="px-3 py-2 text-right font-medium">{t('routes.maxDelay')}</th>
              </tr>
            </thead>
            <tbody>
              {routeAggregates.map((route) => (
                <tr key={route.routeId} className="border-b">
                  <td className="px-3 py-2">
                    <span
                      className="inline-block rounded-md px-2 py-0.5 text-xs font-bold text-white"
                      style={{
                        backgroundColor: RODALIES_LINE_COLORS[route.routeId] ?? '#888888',
                        textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                      }}
                    >
                      {route.routeId}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{route.totalObservations}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{formatDelay(route.avgDelay)}</td>
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
