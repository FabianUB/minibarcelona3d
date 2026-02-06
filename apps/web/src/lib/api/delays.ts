/**
 * Delays & Alerts API Client
 *
 * Fetches delay statistics and service alerts from the backend.
 */

import { fetchWithRetry } from './fetchWithRetry';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

// Types

export interface ServiceAlert {
  alertId: string;
  cause: string;
  effect: string;
  descriptionText: string;
  affectedRoutes: string[];
  isActive: boolean;
  firstSeenAt: string;
  activePeriodStart?: string;
  activePeriodEnd?: string;
  resolvedAt?: string;
}

export interface DelaySummary {
  totalTrains: number;
  delayedTrains: number;
  onTimePercent: number;
  avgDelaySeconds: number;
  maxDelaySeconds: number;
  worstRoute: string;
}

export interface DelayHourlyStat {
  routeId: string;
  hourBucket: string;
  observationCount: number;
  meanDelaySeconds: number;
  stdDevSeconds: number;
  onTimePercent: number;
  maxDelaySeconds: number;
}

export interface DelayStatsResponse {
  summary: DelaySummary;
  hourlyStats: DelayHourlyStat[];
  lastChecked: string;
}

export interface AlertsResponse {
  alerts: ServiceAlert[];
  count: number;
  lastChecked: string;
}

// API Functions

/**
 * Fetch delay statistics with optional route filter
 */
export async function fetchDelayStats(
  routeId?: string,
  period: string = '24h'
): Promise<DelayStatsResponse> {
  const params = new URLSearchParams({ period });
  if (routeId) params.set('route_id', routeId);

  const response = await fetchWithRetry(`${API_BASE}/delays/stats?${params}`, {
    logPrefix: 'Delays API',
    timeoutMs: 5000,
    useCircuitBreaker: false,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch delay stats: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch active service alerts with optional route filter
 */
export async function fetchAlerts(
  routeId?: string,
  lang?: string
): Promise<AlertsResponse> {
  const params = new URLSearchParams();
  if (routeId) params.set('route_id', routeId);
  if (lang) params.set('lang', lang);

  const url = params.toString()
    ? `${API_BASE}/alerts?${params}`
    : `${API_BASE}/alerts`;

  const response = await fetchWithRetry(url, {
    logPrefix: 'Alerts API',
    timeoutMs: 5000,
    useCircuitBreaker: false,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch alerts: ${response.status}`);
  }

  return response.json();
}
