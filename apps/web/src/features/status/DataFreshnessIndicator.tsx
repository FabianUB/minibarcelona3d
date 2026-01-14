/**
 * DataFreshnessIndicator Component
 *
 * Shows a compact indicator of data freshness for all networks.
 * Designed to be placed in the map UI header/footer.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  fetchDataFreshness,
  type DataFreshness,
  type FreshnessStatus,
  getFreshnessStatusColor,
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
  const [freshness, setFreshness] = useState<DataFreshness[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFreshness = useCallback(async () => {
    try {
      const response = await fetchDataFreshness();
      setFreshness(response.networks);
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
  const statusColor = getFreshnessStatusColor(overallStatus);

  // Get the most recent update time
  const getMostRecentAge = (): number => {
    const realTimeNetworks = freshness.filter(
      (f) => f.network === 'rodalies' || f.network === 'metro'
    );
    if (realTimeNetworks.length === 0) return -1;

    const ages = realTimeNetworks
      .map((f) => f.ageSeconds)
      .filter((age) => age >= 0);

    return ages.length > 0 ? Math.min(...ages) : -1;
  };

  if (loading) {
    return (
      <div className="data-freshness-indicator data-freshness-indicator--loading">
        <div className="data-freshness-indicator__dot" style={{ backgroundColor: '#6b7280' }} />
        <span className="data-freshness-indicator__text">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="data-freshness-indicator data-freshness-indicator--error"
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        <div className="data-freshness-indicator__dot" style={{ backgroundColor: '#ef4444' }} />
        <span className="data-freshness-indicator__text">Error</span>
      </div>
    );
  }

  const mostRecentAge = getMostRecentAge();

  return (
    <div
      className={`data-freshness-indicator ${expanded ? 'data-freshness-indicator--expanded' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {/* Compact view */}
      {!expanded && (
        <>
          <div
            className="data-freshness-indicator__dot"
            style={{ backgroundColor: statusColor }}
          />
          <span className="data-freshness-indicator__text">
            {mostRecentAge >= 0 ? formatAge(mostRecentAge) : 'No data'}
          </span>
        </>
      )}

      {/* Expanded view */}
      {expanded && (
        <div className="data-freshness-indicator__networks">
          {freshness
            .filter((f) => f.network === 'rodalies' || f.network === 'metro')
            .map((f) => (
              <div key={f.network} className="data-freshness-indicator__network">
                <div
                  className="data-freshness-indicator__dot"
                  style={{ backgroundColor: getFreshnessStatusColor(f.status) }}
                />
                <span className="data-freshness-indicator__network-name">
                  {getNetworkDisplayName(f.network)}
                </span>
                <span className="data-freshness-indicator__network-age">
                  {f.ageSeconds >= 0 ? formatAge(f.ageSeconds) : 'N/A'}
                </span>
                {f.vehicleCount >= 0 && (
                  <span className="data-freshness-indicator__network-count">
                    ({f.vehicleCount})
                  </span>
                )}
              </div>
            ))}
        </div>
      )}

      <style>{`
        .data-freshness-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          background: rgba(0, 0, 0, 0.6);
          border-radius: 4px;
          font-size: 11px;
          color: #e5e7eb;
          cursor: ${onClick ? 'pointer' : 'default'};
          transition: background 0.2s;
        }

        .data-freshness-indicator:hover {
          background: rgba(0, 0, 0, 0.75);
        }

        .data-freshness-indicator__dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .data-freshness-indicator__text {
          white-space: nowrap;
        }

        .data-freshness-indicator--expanded {
          flex-direction: column;
          align-items: stretch;
          gap: 4px;
          padding: 8px;
        }

        .data-freshness-indicator__networks {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .data-freshness-indicator__network {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .data-freshness-indicator__network-name {
          font-weight: 500;
          min-width: 60px;
        }

        .data-freshness-indicator__network-age {
          color: #9ca3af;
        }

        .data-freshness-indicator__network-count {
          color: #6b7280;
          font-size: 10px;
        }
      `}</style>
    </div>
  );
}
