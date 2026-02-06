import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ServiceAlert } from '../../lib/api/delays';

// Display order matching the legend panel
const ROUTE_ORDER: string[] = [
  'R1', 'R2', 'R2N', 'R2S', 'R3', 'R4', 'R8',
  'R11', 'R13', 'R14', 'R15', 'R16', 'R17', 'RT1',
];

function getRouteIndex(alert: ServiceAlert): number {
  const route = alert.affectedRoutes[0];
  if (!route) return ROUTE_ORDER.length;
  const idx = ROUTE_ORDER.indexOf(route);
  return idx === -1 ? ROUTE_ORDER.length : idx;
}

// Brand colors from RodaliesLine.json — matches the legend and control panel
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
  RG1: '#888888',
  RL1: '#888888',
  RL2: '#888888',
  RL3: '#888888',
  RL4: '#888888',
  RT2: '#888888',
};

interface AlertsListProps {
  alerts: ServiceAlert[];
}

export function AlertsList({ alerts }: AlertsListProps) {
  const { t } = useTranslation('delays');

  const sorted = useMemo(
    () => [...alerts].sort((a, b) => getRouteIndex(a) - getRouteIndex(b)),
    [alerts],
  );

  return (
    <Card className="bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{t('alerts.title')}</CardTitle>
          {alerts.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {alerts.length}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {alerts.length === 0 ? (
          <p className="px-4 py-4 text-center text-sm text-muted-foreground">
            {t('alerts.noAlerts')}
          </p>
        ) : (
          <div className="divide-y divide-border/50">
            {sorted.map((alert) => (
              <AlertRow key={alert.alertId} alert={alert} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AlertRow({ alert }: { alert: ServiceAlert }) {
  const { t } = useTranslation('delays');
  const [open, setOpen] = useState(false);

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

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full text-left">
        <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors">
          {/* Line badge */}
          {alert.affectedRoutes.length > 0 && alert.affectedRoutes.map((route) => (
            <span
              key={route}
              className="rounded-md px-2 py-0.5 text-xs font-bold text-white shrink-0"
              style={{
                backgroundColor: RODALIES_LINE_COLORS[route] ?? '#888888',
                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
              }}
            >
              {route}
            </span>
          ))}
          {/* Effect badge */}
          {alert.effect && (
            <Badge variant="outline" className={`text-xs shrink-0 ${getEffectColor(alert.effect)}`}>
              {t(effectKey, { defaultValue: alert.effect })}
            </Badge>
          )}
          {/* Truncated description preview */}
          <span className="text-xs text-muted-foreground truncate min-w-0 flex-1">
            {alert.descriptionText}
          </span>
          {/* Chevron */}
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-2">
          <p className="text-sm text-foreground">{alert.descriptionText}</p>
          <span className="text-xs text-muted-foreground">
            {t('alerts.since', { time: new Date(alert.firstSeenAt).toLocaleString() })}
          </span>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
