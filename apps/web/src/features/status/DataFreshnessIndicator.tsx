/**
 * DataFreshnessIndicator Component
 *
 * Shows a compact indicator of data freshness for all networks.
 * Designed to be placed in the map UI header/footer.
 * Uses Tailwind CSS to match main app styling.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import {
  fetchDataFreshness,
  type DataFreshness,
  type FreshnessStatus,
  formatAge,
  getNetworkDisplayName,
} from '../../lib/api/health';

interface DataFreshnessIndicatorProps {
  /** How often to refresh data (ms). Default: 30000 (30s) */
  refreshInterval?: number;
  /** Whether to show expanded view with all networks */
  expanded?: boolean;
  /** Callback when indicator is clicked */
  onClick?: () => void;
}

export function DataFreshnessIndicator({
  refreshInterval = 30000,
  expanded = false,
  onClick,
}: DataFreshnessIndicatorProps) {
  const { t } = useTranslation('status');
  const [freshness, setFreshness] = useState<DataFreshness[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Track when data was last fetched to calculate elapsed time locally
  const [lastFetchTime, setLastFetchTime] = useState<number>(Date.now());
  // Counter to force re-render for time updates
  const [, setTick] = useState(0);

  const loadFreshness = useCallback(async () => {
    try {
      const response = await fetchDataFreshness();
      setFreshness(response.networks);
      setLastFetchTime(Date.now());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFreshness();
    const interval = setInterval(loadFreshness, refreshInterval);
    return () => clearInterval(interval);
  }, [loadFreshness, refreshInterval]);

  // Update displayed time every second
  useEffect(() => {
    const tickInterval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(tickInterval);
  }, []);

  // Calculate overall status
  const getOverallStatus = (): FreshnessStatus => {
    if (freshness.length === 0) return 'unavailable';

    const realTimeNetworks = freshness.filter(
      (f) => f.network === 'rodalies' || f.network === 'metro'
    );

    if (realTimeNetworks.some((f) => f.status === 'unavailable')) {
      return 'unavailable';
    }
    if (realTimeNetworks.some((f) => f.status === 'stale')) {
      return 'stale';
    }
    return 'fresh';
  };

  const overallStatus = getOverallStatus();

  const getStatusDotClass = (status: FreshnessStatus): string => {
    switch (status) {
      case 'fresh':
        return 'bg-green-500';
      case 'stale':
        return 'bg-yellow-500';
      case 'unavailable':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  // Calculate elapsed seconds since last API fetch
  const elapsedSinceLastFetch = Math.floor((Date.now() - lastFetchTime) / 1000);

  // Get the most recent update time (adjusted for elapsed time)
  const getMostRecentAge = (): number => {
    const realTimeNetworks = freshness.filter(
      (f) => f.network === 'rodalies' || f.network === 'metro'
    );
    if (realTimeNetworks.length === 0) return -1;

    const ages = realTimeNetworks
      .map((f) => f.ageSeconds)
      .filter((age) => age >= 0);

    if (ages.length === 0) return -1;
    // Add elapsed time since last fetch to the reported age
    return Math.min(...ages) + elapsedSinceLastFetch;
  };

  // Get adjusted age for a specific network
  const getAdjustedAge = (ageSeconds: number): number => {
    if (ageSeconds < 0) return ageSeconds;
    return ageSeconds + elapsedSinceLastFetch;
  };

  if (loading) {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2 py-1 bg-card/80 backdrop-blur-sm rounded text-xs text-muted-foreground border border-border"
      >
        <div className="w-2 h-2 rounded-full bg-gray-500 animate-pulse" />
        <span>{t('freshness.loading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2 py-1 bg-card/80 backdrop-blur-sm rounded text-xs text-muted-foreground border border-border ${onClick ? 'cursor-pointer hover:bg-accent/50' : ''}`}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        <div className="w-2 h-2 rounded-full bg-red-500" />
        <span>{t('freshness.error')}</span>
      </div>
    );
  }

  const mostRecentAge = getMostRecentAge();

  return (
    <div
      className={`inline-flex ${expanded ? 'flex-col' : ''} items-center gap-1.5 px-2 py-1 bg-card/80 backdrop-blur-sm rounded text-xs border border-border transition-colors ${onClick ? 'cursor-pointer hover:bg-accent/50' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      {/* Compact view */}
      {!expanded && (
        <>
          <div className={`w-2 h-2 rounded-full ${getStatusDotClass(overallStatus)}`} />
          <span className="text-foreground whitespace-nowrap">
            {mostRecentAge >= 0 ? formatAge(mostRecentAge) : t('freshness.noData')}
          </span>
        </>
      )}

      {/* Expanded view */}
      {expanded && (
        <div className="space-y-1 w-full">
          {freshness
            .filter((f) => f.network === 'rodalies' || f.network === 'metro')
            .map((f) => (
              <div key={f.network} className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${getStatusDotClass(f.status)}`} />
                <span className="font-medium min-w-[50px]">
                  {getNetworkDisplayName(f.network)}
                </span>
                <span className="text-muted-foreground">
                  {f.ageSeconds >= 0 ? formatAge(getAdjustedAge(f.ageSeconds)) : t('freshness.notAvailable')}
                </span>
                {f.vehicleCount >= 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0">
                    {f.vehicleCount}
                  </Badge>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
