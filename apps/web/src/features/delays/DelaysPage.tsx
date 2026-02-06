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
import {
  fetchDelayStats,
  fetchAlerts,
  type DelaySummary,
  type DelayedTrain,
  type DelayHourlyStat,
  type ServiceAlert,
} from '../../lib/api/delays';
import { DelayedTrainsList } from './DelaySummaryCards';
import { AlertsList } from './AlertsList';
import { RouteBreakdownTable } from './RouteBreakdownTable';
import { OnTimeChart } from './OnTimeChart';

const REFRESH_INTERVAL = 30000; // 30 seconds

type Period = '24h' | '48h' | '168h';

export function DelaysPage() {
  const { t, i18n } = useTranslation('delays');
  const [summary, setSummary] = useState<DelaySummary | null>(null);
  const [delayedTrains, setDelayedTrains] = useState<DelayedTrain[]>([]);
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
      setDelayedTrains(statsResponse.delayedTrains);
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
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-4">
        {/* Header */}
        <header className="text-center space-y-2">
          <h1 className="text-2xl md:text-3xl font-bold">{t('page.title')}</h1>
          <p className="text-muted-foreground">{t('page.subtitle')}</p>
        </header>

        {/* KPI Metric Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground">{t('metrics.onTime')}</p>
                <p className={`text-2xl font-bold ${
                  summary.onTimePercent >= 90 ? 'text-green-500' :
                  summary.onTimePercent >= 75 ? 'text-yellow-500' : 'text-red-500'
                }`}>
                  {summary.onTimePercent.toFixed(1)}%
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground">{t('metrics.delayed')}</p>
                <p className={`text-2xl font-bold ${
                  summary.delayedTrains === 0 ? 'text-green-500' : 'text-red-500'
                }`}>
                  {t('metrics.delayedOf', { delayed: summary.delayedTrains, total: summary.totalTrains })}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground">{t('metrics.avgDelay')}</p>
                <p className={`text-2xl font-bold ${
                  summary.avgDelaySeconds <= 60 ? 'text-green-500' :
                  summary.avgDelaySeconds <= 300 ? 'text-yellow-500' : 'text-red-500'
                }`}>
                  {t('metrics.min', { value: (summary.avgDelaySeconds / 60).toFixed(1) })}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground">{t('metrics.maxDelay')}</p>
                <p className="text-2xl font-bold">
                  {t('metrics.min', { value: Math.round(summary.maxDelaySeconds / 60) })}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Delayed Trains + Alerts side-by-side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {summary && (
            <DelayedTrainsList trains={delayedTrains} totalTrains={summary.totalTrains} />
          )}
          <AlertsList alerts={alerts} />
        </div>

        {/* Historical Section — period selector + chart + breakdown */}
        <OnTimeChart hourlyStats={hourlyStats} hours={periodHours} periodSelector={
          <div className="flex items-center gap-1.5">
            {(['24h', '48h', '168h'] as Period[]).map((p) => (
              <Button
                key={p}
                variant={period === p ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => setPeriod(p)}
              >
                {t(`period.${p === '168h' ? '7d' : p}`)}
              </Button>
            ))}
          </div>
        } />

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
