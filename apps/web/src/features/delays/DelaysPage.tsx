/**
 * DelaysPage Component
 *
 * Dashboard showing Rodalies delay statistics and service alerts.
 * Accessible at /delays route.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  fetchDelayStats,
  fetchAlerts,
  type DelaySummary,
  type DelayHourlyStat,
  type ServiceAlert,
} from '../../lib/api/delays';
import { DelaySummaryCards } from './DelaySummaryCards';
import { AlertsList } from './AlertsList';
import { RouteBreakdownTable } from './RouteBreakdownTable';
import { OnTimeChart } from './OnTimeChart';

const REFRESH_INTERVAL = 30000; // 30 seconds

type Period = '24h' | '48h' | '168h';

export function DelaysPage() {
  const { t, i18n } = useTranslation('delays');
  const [summary, setSummary] = useState<DelaySummary | null>(null);
  const [hourlyStats, setHourlyStats] = useState<DelayHourlyStat[]>([]);
  const [alerts, setAlerts] = useState<ServiceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [period, setPeriod] = useState<Period>('24h');

  const loadData = useCallback(async () => {
    try {
      const [statsResponse, alertsResponse] = await Promise.all([
        fetchDelayStats(undefined, period),
        fetchAlerts(undefined, i18n.language),
      ]);

      setSummary(statsResponse.summary);
      setHourlyStats(statsResponse.hourlyStats);
      setAlerts(alertsResponse.alerts);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [period, i18n.language, t]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [loadData]);

  const periodHours = period === '24h' ? 24 : period === '48h' ? 48 : 168;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="text-muted-foreground">{t('common:loading.status')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">{t('error.unableToLoad')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">{error}</p>
            <Button onClick={loadData} variant="default">
              {t('common:buttons.retry')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
        {/* Header */}
        <header className="text-center space-y-2">
          <h1 className="text-2xl md:text-3xl font-bold">{t('page.title')}</h1>
          <p className="text-muted-foreground">{t('page.subtitle')}</p>
        </header>

        {/* Live Snapshot */}
        {summary && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">{t('snapshot.title')}</h2>
            <DelaySummaryCards summary={summary} />
          </section>
        )}

        {/* Service Alerts */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t('alerts.title')}</h2>
          <AlertsList alerts={alerts} />
        </section>

        <Separator />

        {/* Period Selector */}
        <div className="flex items-center gap-2 justify-center">
          {(['24h', '48h', '168h'] as Period[]).map((p) => (
            <Button
              key={p}
              variant={period === p ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPeriod(p)}
            >
              {t(`period.${p === '168h' ? '7d' : p}`)}
            </Button>
          ))}
        </div>

        {/* On-Time Chart */}
        <OnTimeChart hourlyStats={hourlyStats} hours={periodHours} />

        {/* Route Breakdown */}
        <RouteBreakdownTable hourlyStats={hourlyStats} />

        {/* Footer */}
        <footer className="text-center space-y-3 pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground">
            {t('footer.lastUpdated', { time: lastRefresh ? lastRefresh.toLocaleTimeString() : 'Never' })}
            {' · '}
            {t('footer.autoRefresh')}
            {' · '}
            {t('footer.threshold')}
          </p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" size="sm" asChild>
              <a href="/status">{t('common:loading.status')}</a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="/">{t('common:buttons.backToMap')}</a>
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
