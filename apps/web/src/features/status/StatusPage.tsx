/**
 * StatusPage Component
 *
 * Public status page showing health of all transit networks.
 * Accessible at /status route.
 * Uses ShadCN UI components to match main app styling.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  fetchNetworkHealth,
  type NetworkHealth,
  type OverallHealth,
  type HealthStatus,
  type ConfidenceLevel,
  getNetworkDisplayName,
} from '../../lib/api/health';
import { HealthSparkline } from './HealthSparkline';
import { BaselineMaturity } from './BaselineMaturity';

const REFRESH_INTERVAL = 30000; // 30 seconds

export function StatusPage() {
  const { t } = useTranslation('status');
  const [overall, setOverall] = useState<OverallHealth | null>(null);
  const [networks, setNetworks] = useState<NetworkHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetchNetworkHealth();
      setOverall(response.overall);
      setNetworks(response.networks);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadHealth();
    const interval = setInterval(loadHealth, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [loadHealth]);

  const getOverallStatusText = (status: string) => {
    switch (status) {
      case 'operational':
        return t('overall.operational');
      case 'degraded':
        return t('overall.degraded');
      case 'outage':
        return t('overall.outage');
      default:
        return t('overall.unknown');
    }
  };

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
            <Button onClick={loadHealth} variant="default">
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
          <p className="text-muted-foreground">
            {t('page.subtitle')}
          </p>
        </header>

        {/* Overall Status Banner */}
        {overall && (
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${overall.status === 'operational' ? 'bg-green-500' : overall.status === 'degraded' ? 'bg-yellow-500' : 'bg-red-500'}`} />
              <span className="text-sm font-medium text-muted-foreground">
                {getOverallStatusText(overall.status)}
              </span>
              <span className="text-xs text-muted-foreground/60">
                {overall.healthScore}%
              </span>
            </div>
            <HealthSparkline network="overall" width={200} height={40} hours={2} />
          </div>
        )}

        {/* Network Cards */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t('sections.networkStatus')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {networks.map((network) => (
              <NetworkCard key={network.network} network={network} />
            ))}
          </div>
        </section>

        {/* Delay Dashboard Link */}
        <div className="text-center">
          <Button variant="outline" size="sm" asChild>
            <a href="/delays">{t('delays.viewDelays', { defaultValue: 'View Rodalies Delay Stats' })}</a>
          </Button>
        </div>

        {/* Baseline Learning Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t('sections.mlBaseline')}</h2>
          <BaselineMaturity />
        </section>

        <Separator />

        {/* Metrics Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t('sections.systemMetrics')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {overall && (
              <>
                <MetricCard
                  label={t('metrics.uptime')}
                  value={`${overall.uptimePercent.toFixed(1)}%`}
                  status={overall.uptimePercent >= 99 ? 'healthy' : overall.uptimePercent >= 95 ? 'degraded' : 'unhealthy'}
                />
                <MetricCard
                  label={t('metrics.activeIncidents')}
                  value={overall.activeIncidents.toString()}
                  status={overall.activeIncidents === 0 ? 'healthy' : 'degraded'}
                />
                <MetricCard
                  label={t('metrics.networks')}
                  value={networks.length.toString()}
                  status="healthy"
                />
                <MetricCard
                  label={t('metrics.healthScore')}
                  value={`${overall.healthScore}%`}
                  status={overall.healthScore >= 80 ? 'healthy' : overall.healthScore >= 50 ? 'degraded' : 'unhealthy'}
                />
              </>
            )}
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center space-y-3 pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground">
            {t('footer.lastUpdated', { time: lastRefresh ? lastRefresh.toLocaleTimeString() : 'Never' })}
            {' · '}
            {t('footer.autoRefresh')}
          </p>
          <Button variant="outline" size="sm" asChild>
            <a href="/">{t('common:buttons.backToMap')}</a>
          </Button>
        </footer>
      </div>
    </div>
  );
}

// Network Card Component
function NetworkCard({ network }: { network: NetworkHealth }) {
  const { t } = useTranslation('status');
  const isRealTime = network.network === 'rodalies' || network.network === 'metro';

  const getStatusColor = (status: HealthStatus): string => {
    switch (status) {
      case 'healthy':
        return 'bg-green-500';
      case 'degraded':
        return 'bg-yellow-500';
      case 'unhealthy':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getConfidenceBadgeClass = (level: ConfidenceLevel): string => {
    switch (level) {
      case 'high':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'medium':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'low':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getDataSourceLabel = (): string => {
    switch (network.network) {
      case 'rodalies':
        return t('network.dataSourceGps');
      case 'metro':
        return t('network.dataSourceInterpolation');
      default:
        return t('network.dataSourceStatic');
    }
  };

  return (
    <Card className="bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${getStatusColor(network.status)}`} />
            <CardTitle className="text-base">{getNetworkDisplayName(network.network)}</CardTitle>
          </div>
          <Badge variant="outline" className="text-xs uppercase">
            {network.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Health Score Bar with Sparkline */}
        <div className="space-y-1">
          <div className="flex justify-between items-center text-xs text-muted-foreground">
            <span>{t('network.healthScore')}</span>
            <div className="flex items-center gap-2">
              <HealthSparkline network={network.network} width={80} height={20} hours={2} />
              <span className="font-medium text-foreground">{network.healthScore}%</span>
            </div>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getStatusColor(network.status)}`}
              style={{ width: `${network.healthScore}%` }}
            />
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          {/* Freshness and Quality only for real-time networks */}
          {isRealTime && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('network.freshness')}</span>
                <span>{network.dataFreshness}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('network.quality')}</span>
                <span>{network.dataQuality}%</span>
              </div>
            </>
          )}
          {/* Active Vehicles for all networks */}
          {network.vehicleCount >= 0 && (
            <div className="flex justify-between col-span-2">
              <span className="text-muted-foreground">{t('network.activeVehicles')}</span>
              <span>
                {network.vehicleCount}
                {network.expectedCount !== undefined && (
                  <span className="text-muted-foreground/60 ml-1">
                    {t('network.expected', { count: network.expectedCount })}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Anomaly Warning */}
        {network.activeAnomalies > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded px-2 py-1 text-xs text-yellow-400">
            {t('network.anomalyDetected', { count: network.activeAnomalies })}
          </div>
        )}

        <Separator />

        {/* Confidence & Data Source */}
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className={`text-xs ${getConfidenceBadgeClass(network.confidenceLevel)}`}>
            {t('network.confidence', { level: network.confidenceLevel })}
          </Badge>
          <span className="text-xs text-muted-foreground">{getDataSourceLabel()}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// Metric Card Component
function MetricCard({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: HealthStatus;
}) {
  const getValueColor = (status: HealthStatus): string => {
    switch (status) {
      case 'healthy':
        return 'text-green-500';
      case 'degraded':
        return 'text-yellow-500';
      case 'unhealthy':
        return 'text-red-500';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <Card className="bg-card/50 backdrop-blur-sm">
      <CardContent className="py-4 text-center">
        <p className={`text-2xl font-bold ${getValueColor(status)}`}>{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </CardContent>
    </Card>
  );
}
