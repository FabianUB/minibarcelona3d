import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DelayedTrain } from '../../lib/api/delays';

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

interface DelayedTrainsListProps {
  trains: DelayedTrain[];
  totalTrains: number;
}

export function DelayedTrainsList({ trains, totalTrains }: DelayedTrainsListProps) {
  const { t } = useTranslation('delays');

  const sorted = useMemo(
    () => [...trains].sort((a, b) => {
      const idxA = ROUTE_ORDER.indexOf(a.lineCode);
      const idxB = ROUTE_ORDER.indexOf(b.lineCode);
      const orderA = idxA === -1 ? ROUTE_ORDER.length : idxA;
      const orderB = idxB === -1 ? ROUTE_ORDER.length : idxB;
      if (orderA !== orderB) return orderA - orderB;
      // Within same line, sort by most delayed first
      return b.delaySeconds - a.delaySeconds;
    }),
    [trains],
  );

  const formatDelay = (seconds: number): string => {
    const mins = Math.round(Math.abs(seconds) / 60);
    if (mins < 1) return t('snapshot.lessThanOneMin');
    return t('snapshot.minuteDelay', { count: mins });
  };

  if (trains.length === 0) {
    return (
      <Card className="bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('snapshot.title')}</CardTitle>
        </CardHeader>
        <CardContent className="py-4 text-center text-green-500 font-medium">
          {t('snapshot.allOnTime', { total: totalTrains, defaultValue: `All ${totalTrains} trains on time` })}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{t('snapshot.title')}</CardTitle>
          <span className="text-xs text-muted-foreground">
            {t('snapshot.delayedCount', {
              delayed: trains.length,
              total: totalTrains,
              defaultValue: `${trains.length} of ${totalTrains} delayed`,
            })}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-auto max-h-[400px]">
          <table className="w-full text-sm">
            <thead className="bg-muted sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('routes.route')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('snapshot.delay', { defaultValue: 'Delay' })}</th>
                <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">{t('snapshot.prevStop', { defaultValue: 'From' })}</th>
                <th className="px-3 py-2 text-left font-medium">{t('snapshot.nextStop', { defaultValue: 'Next stop' })}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((train) => (
                <tr key={train.vehicleLabel} className="border-b">
                  <td className="px-3 py-2">
                    <span
                      className="inline-block rounded-md px-2 py-0.5 text-xs font-bold text-white"
                      style={{
                        backgroundColor: RODALIES_LINE_COLORS[train.lineCode] ?? '#888888',
                        textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                      }}
                    >
                      {train.lineCode || '?'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="font-mono text-xs font-bold text-red-500">
                      +{formatDelay(train.delaySeconds)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[140px] hidden sm:table-cell">
                    {train.prevStopName || '-'}
                  </td>
                  <td className="px-3 py-2 text-xs truncate max-w-[140px]">
                    {train.nextStopName || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
