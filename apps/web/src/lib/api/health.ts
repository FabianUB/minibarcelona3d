/**
 * Health API Client
 *
 * Fetches health and metrics data from the backend.
 */

import { fetchWithRetry } from './fetchWithRetry';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

// Types

export type NetworkType = 'rodalies' | 'metro' | 'bus' | 'tram' | 'fgc';

export type FreshnessStatus = 'fresh' | 'stale' | 'unavailable';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export type OverallStatus = 'operational' | 'degraded' | 'outage';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface DataFreshness {
  network: NetworkType;
  lastPolledAt: string | null;
  ageSeconds: number;
  status: FreshnessStatus;
  vehicleCount: number;
}

export interface NetworkHealth {
  network: NetworkType;
  healthScore: number;
  status: HealthStatus;
  dataFreshness: number;
  serviceLevel: number;
  dataQuality: number;
  vehicleCount: number;
  expectedCount?: number;
  lastUpdated: string;
  confidenceLevel: ConfidenceLevel;
  activeAnomalies: number;
}

export interface OverallHealth {
  status: OverallStatus;
  healthScore: number;
  networks: NetworkHealth[];
  lastUpdated: string;
  uptimePercent: number;
  activeIncidents: number;
}

export interface DataFreshnessResponse {
  networks: DataFreshness[];
  lastChecked: string;
}

export interface NetworkHealthResponse {
  overall: OverallHealth;
  networks: NetworkHealth[];
}

// API Functions

/**
 * Fetch data freshness for all networks
 */
export async function fetchDataFreshness(): Promise<DataFreshnessResponse> {
  const response = await fetchWithRetry(`${API_BASE}/health/data`, {
    logPrefix: 'Health API',
    timeoutMs: 5000,
    useCircuitBreaker: false, // Don't circuit break health checks
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch data freshness: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch network health scores
 */
export async function fetchNetworkHealth(): Promise<NetworkHealthResponse> {
  const response = await fetchWithRetry(`${API_BASE}/health/networks`, {
    logPrefix: 'Health API',
    timeoutMs: 5000,
    useCircuitBreaker: false,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch network health: ${response.status}`);
  }

  return response.json();
}

// Utility Functions

/**
 * Get display name for a network
 */
export function getNetworkDisplayName(network: NetworkType): string {
  const names: Record<NetworkType, string> = {
    rodalies: 'Rodalies',
    metro: 'Metro',
    bus: 'Bus',
    tram: 'Tram',
    fgc: 'FGC',
  };
  return names[network] || network;
}

/**
 * Get color for health status
 */
export function getHealthStatusColor(status: HealthStatus): string {
  const colors: Record<HealthStatus, string> = {
    healthy: '#22c55e',    // green-500
    degraded: '#eab308',   // yellow-500
    unhealthy: '#ef4444',  // red-500
    unknown: '#6b7280',    // gray-500
  };
  return colors[status] || colors.unknown;
}

/**
 * Get color for overall status
 */
export function getOverallStatusColor(status: OverallStatus): string {
  const colors: Record<OverallStatus, string> = {
    operational: '#22c55e',
    degraded: '#eab308',
    outage: '#ef4444',
  };
  return colors[status] || '#6b7280';
}

/**
 * Get color for freshness status
 */
export function getFreshnessStatusColor(status: FreshnessStatus): string {
  const colors: Record<FreshnessStatus, string> = {
    fresh: '#22c55e',
    stale: '#eab308',
    unavailable: '#ef4444',
  };
  return colors[status] || '#6b7280';
}

/**
 * Format age in human-readable format
 */
export function formatAge(ageSeconds: number): string {
  if (ageSeconds < 0) return 'Unknown';
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ago`;
  return `${Math.floor(ageSeconds / 3600)}h ago`;
}
