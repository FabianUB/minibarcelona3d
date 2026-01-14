/**
 * StatusPage Component
 *
 * Public status page showing health of all transit networks.
 * Accessible at /status route.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  fetchNetworkHealth,
  type NetworkHealth,
  type OverallHealth,
  type HealthStatus,
  getNetworkDisplayName,
  getHealthStatusColor,
  getOverallStatusColor,
} from '../../lib/api/health';

const REFRESH_INTERVAL = 30000; // 30 seconds

export function StatusPage() {
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
      setError(err instanceof Error ? err.message : 'Failed to load status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
    const interval = setInterval(loadHealth, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [loadHealth]);

  const getOverallStatusText = (status: string) => {
    switch (status) {
      case 'operational':
        return 'All Systems Operational';
      case 'degraded':
        return 'Partial System Outage';
      case 'outage':
        return 'Major System Outage';
      default:
        return 'Status Unknown';
    }
  };

  if (loading) {
    return (
      <div className="status-page">
        <div className="status-page__loading">Loading status...</div>
        <style>{styles}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="status-page">
        <div className="status-page__error">
          <h2>Unable to load status</h2>
          <p>{error}</p>
          <button onClick={loadHealth}>Retry</button>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="status-page">
      {/* Header */}
      <header className="status-page__header">
        <h1>MiniBarcelona3D Status</h1>
        <p className="status-page__subtitle">
          Real-time status of Barcelona transit data services
        </p>
      </header>

      {/* Overall Status Banner */}
      {overall && (
        <div
          className="status-page__banner"
          style={{ backgroundColor: getOverallStatusColor(overall.status) }}
        >
          <span className="status-page__banner-icon">
            {overall.status === 'operational' ? '✓' : overall.status === 'degraded' ? '!' : '✕'}
          </span>
          <span className="status-page__banner-text">
            {getOverallStatusText(overall.status)}
          </span>
          <span className="status-page__banner-score">
            Health Score: {overall.healthScore}%
          </span>
        </div>
      )}

      {/* Network Cards */}
      <section className="status-page__networks">
        <h2>Network Status</h2>
        <div className="status-page__network-grid">
          {networks.map((network) => (
            <NetworkCard key={network.network} network={network} />
          ))}
        </div>
      </section>

      {/* Metrics Section */}
      <section className="status-page__metrics">
        <h2>System Metrics</h2>
        <div className="status-page__metrics-grid">
          {overall && (
            <>
              <MetricCard
                label="Uptime (24h)"
                value={`${overall.uptimePercent.toFixed(1)}%`}
                status={overall.uptimePercent >= 99 ? 'healthy' : overall.uptimePercent >= 95 ? 'degraded' : 'unhealthy'}
              />
              <MetricCard
                label="Active Incidents"
                value={overall.activeIncidents.toString()}
                status={overall.activeIncidents === 0 ? 'healthy' : 'degraded'}
              />
            </>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="status-page__footer">
        <p>
          Last updated: {lastRefresh ? lastRefresh.toLocaleTimeString() : 'Never'}
          {' · '}
          Auto-refreshes every 30 seconds
        </p>
        <a href="/" className="status-page__back-link">
          ← Back to Map
        </a>
      </footer>

      <style>{styles}</style>
    </div>
  );
}

// Network Card Component
function NetworkCard({ network }: { network: NetworkHealth }) {
  const statusColor = getHealthStatusColor(network.status);
  const isRealTime = network.network === 'rodalies' || network.network === 'metro';

  return (
    <div className="network-card">
      <div className="network-card__header">
        <div
          className="network-card__status-dot"
          style={{ backgroundColor: statusColor }}
        />
        <h3 className="network-card__name">{getNetworkDisplayName(network.network)}</h3>
        <span
          className="network-card__status-badge"
          style={{ backgroundColor: statusColor }}
        >
          {network.status}
        </span>
      </div>

      <div className="network-card__score">
        <div className="network-card__score-bar">
          <div
            className="network-card__score-fill"
            style={{
              width: `${network.healthScore}%`,
              backgroundColor: statusColor,
            }}
          />
        </div>
        <span className="network-card__score-value">{network.healthScore}%</span>
      </div>

      <div className="network-card__details">
        {isRealTime && (
          <>
            <div className="network-card__detail">
              <span className="network-card__detail-label">Data Freshness</span>
              <span className="network-card__detail-value">{network.dataFreshness}%</span>
            </div>
            <div className="network-card__detail">
              <span className="network-card__detail-label">Data Quality</span>
              <span className="network-card__detail-value">{network.dataQuality}%</span>
            </div>
            <div className="network-card__detail">
              <span className="network-card__detail-label">Active Vehicles</span>
              <span className="network-card__detail-value">{network.vehicleCount}</span>
            </div>
          </>
        )}
        <div className="network-card__detail">
          <span className="network-card__detail-label">Confidence</span>
          <span className="network-card__detail-value">{network.confidenceLevel}</span>
        </div>
      </div>

      {!isRealTime && (
        <div className="network-card__schedule-note">
          Schedule-based positioning
        </div>
      )}
    </div>
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
  return (
    <div className="metric-card">
      <span className="metric-card__value" style={{ color: getHealthStatusColor(status) }}>
        {value}
      </span>
      <span className="metric-card__label">{label}</span>
    </div>
  );
}

// Styles
const styles = `
  .status-page {
    min-height: 100vh;
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: #f1f5f9;
    font-family: system-ui, -apple-system, sans-serif;
    padding: 2rem;
  }

  .status-page__header {
    text-align: center;
    margin-bottom: 2rem;
  }

  .status-page__header h1 {
    font-size: 2rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
  }

  .status-page__subtitle {
    color: #94a3b8;
    margin: 0;
  }

  .status-page__banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 1rem 2rem;
    border-radius: 0.75rem;
    margin-bottom: 2rem;
    color: white;
    font-weight: 600;
  }

  .status-page__banner-icon {
    font-size: 1.5rem;
  }

  .status-page__banner-text {
    font-size: 1.25rem;
  }

  .status-page__banner-score {
    margin-left: auto;
    font-size: 0.9rem;
    opacity: 0.9;
  }

  .status-page__networks h2,
  .status-page__metrics h2 {
    font-size: 1.25rem;
    margin: 0 0 1rem 0;
    color: #e2e8f0;
  }

  .status-page__network-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .status-page__metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .status-page__footer {
    text-align: center;
    color: #64748b;
    font-size: 0.875rem;
    margin-top: 2rem;
    padding-top: 2rem;
    border-top: 1px solid #334155;
  }

  .status-page__back-link {
    color: #60a5fa;
    text-decoration: none;
    display: inline-block;
    margin-top: 0.5rem;
  }

  .status-page__back-link:hover {
    text-decoration: underline;
  }

  .status-page__loading,
  .status-page__error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 50vh;
    text-align: center;
  }

  .status-page__error button {
    margin-top: 1rem;
    padding: 0.5rem 1rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
  }

  /* Network Card */
  .network-card {
    background: rgba(30, 41, 59, 0.8);
    border-radius: 0.75rem;
    padding: 1.25rem;
    border: 1px solid #334155;
  }

  .network-card__header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .network-card__status-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }

  .network-card__name {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0;
    flex-grow: 1;
  }

  .network-card__status-badge {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    color: white;
  }

  .network-card__score {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .network-card__score-bar {
    flex-grow: 1;
    height: 8px;
    background: #334155;
    border-radius: 4px;
    overflow: hidden;
  }

  .network-card__score-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .network-card__score-value {
    font-weight: 600;
    min-width: 3rem;
    text-align: right;
  }

  .network-card__details {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .network-card__detail {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
  }

  .network-card__detail-label {
    color: #94a3b8;
  }

  .network-card__detail-value {
    font-weight: 500;
  }

  .network-card__schedule-note {
    margin-top: 0.75rem;
    font-size: 0.75rem;
    color: #64748b;
    text-align: center;
    padding-top: 0.75rem;
    border-top: 1px solid #334155;
  }

  /* Metric Card */
  .metric-card {
    background: rgba(30, 41, 59, 0.8);
    border-radius: 0.75rem;
    padding: 1.25rem;
    text-align: center;
    border: 1px solid #334155;
  }

  .metric-card__value {
    display: block;
    font-size: 2rem;
    font-weight: 700;
  }

  .metric-card__label {
    display: block;
    font-size: 0.85rem;
    color: #94a3b8;
    margin-top: 0.25rem;
  }

  @media (max-width: 640px) {
    .status-page {
      padding: 1rem;
    }

    .status-page__banner {
      flex-direction: column;
      text-align: center;
    }

    .status-page__banner-score {
      margin-left: 0;
    }

    .network-card__details {
      grid-template-columns: 1fr;
    }
  }
`;
