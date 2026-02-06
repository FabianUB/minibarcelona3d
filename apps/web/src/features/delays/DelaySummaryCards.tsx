import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import type { DelaySummary } from '../../lib/api/delays';

interface DelaySummaryCardsProps {
  summary: DelaySummary;
}

export function DelaySummaryCards({ summary }: DelaySummaryCardsProps) {
  const { t } = useTranslation('delays');

  const cards = [
    {
      label: t('snapshot.onTimePercent'),
      value: `${summary.onTimePercent.toFixed(1)}%`,
      color: summary.onTimePercent >= 90 ? 'text-green-500' : summary.onTimePercent >= 70 ? 'text-yellow-500' : 'text-red-500',
    },
    {
      label: t('snapshot.avgDelay'),
      value: t('snapshot.seconds', { count: Math.round(summary.avgDelaySeconds) }),
      color: summary.avgDelaySeconds <= 60 ? 'text-green-500' : summary.avgDelaySeconds <= 300 ? 'text-yellow-500' : 'text-red-500',
    },
    {
      label: t('snapshot.delayedTrains'),
      value: `${summary.delayedTrains}/${summary.totalTrains}`,
      color: summary.delayedTrains === 0 ? 'text-green-500' : 'text-red-500',
    },
    {
      label: t('snapshot.worstRoute'),
      value: summary.worstRoute || '-',
      color: 'text-foreground',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.label} className="bg-card/50 backdrop-blur-sm">
          <CardContent className="py-4 text-center">
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{card.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
