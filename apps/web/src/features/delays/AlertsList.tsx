import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ServiceAlert } from '../../lib/api/delays';

interface AlertsListProps {
  alerts: ServiceAlert[];
}

export function AlertsList({ alerts }: AlertsListProps) {
  const { t } = useTranslation('delays');

  if (alerts.length === 0) {
    return (
      <Card className="bg-card/50 backdrop-blur-sm">
        <CardContent className="py-6 text-center text-muted-foreground">
          {t('alerts.noAlerts')}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert) => (
        <AlertCard key={alert.alertId} alert={alert} />
      ))}
    </div>
  );
}

function AlertCard({ alert }: { alert: ServiceAlert }) {
  const { t } = useTranslation('delays');

  const getEffectColor = (effect: string): string => {
    switch (effect) {
      case 'NO_SERVICE':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'REDUCED_SERVICE':
      case 'SIGNIFICANT_DELAYS':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'MODIFIED_SERVICE':
      case 'DETOUR':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      default:
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    }
  };

  const effectKey = `alerts.effect.${alert.effect}` as const;
  const causeKey = `alerts.cause.${alert.cause}` as const;

  return (
    <Card className="bg-card/50 backdrop-blur-sm border-l-4 border-l-yellow-500">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {alert.effect && (
              <Badge variant="outline" className={`text-xs ${getEffectColor(alert.effect)}`}>
                {t(effectKey, { defaultValue: alert.effect })}
              </Badge>
            )}
            {alert.cause && (
              <Badge variant="outline" className="text-xs">
                {t(causeKey, { defaultValue: alert.cause })}
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {t('alerts.since', { time: new Date(alert.firstSeenAt).toLocaleString() })}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm">{alert.descriptionText}</p>
        {alert.affectedRoutes.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">{t('alerts.affectedRoutes')}:</span>
            {alert.affectedRoutes.map((route) => (
              <Badge key={route} variant="secondary" className="text-xs">
                {route}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
