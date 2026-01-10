/**
 * Barcelona Bus route configuration for position simulation
 *
 * Default headway and speed values for TMB bus routes.
 * High-frequency routes (H-lines, V-lines) have shorter headways.
 *
 * Source: TMB (Transports Metropolitans de Barcelona)
 */

import type { LineConfig } from '../types/transit';

/**
 * Top 10 most used bus lines in Barcelona by annual ridership.
 * Used as default filter to reduce visual clutter.
 *
 * Source: TMB annual ridership data (millions of passengers):
 * - H6: 10.6M (Zona Universitària – Onze de Setembre)
 * - H4: 8.7M (Zona Universitària – Bon Pastor)
 * - H8: 8.1M (Ernest Lluch – Bon Pastor)
 * - D20: 7.1M (Pg. Marítim – Ernest Lluch)
 * - D40: 7.0M (Pl. Espanya – Canyelles)
 * - H12: 6.5M (Gornal – Besòs/Verneda)
 * - 7: 6.4M (Zona Universitària – Fòrum)
 * - V19: 6.2M (Barceloneta – Pl. Alfons Comín)
 * - H16: 6.2M (Pg. Zona Franca – Fòrum Camp Besòs)
 * - D50: 5.8M (Paral·lel – Ciutat Meridiana)
 */
export const TOP_BUS_LINES = [
  'H6',
  'H4',
  'H8',
  'D20',
  'D40',
  'H12',
  '7',
  'V19',
  'H16',
  'D50',
] as const;

export type TopBusLine = (typeof TOP_BUS_LINES)[number];

/**
 * Check if a route code is one of the top bus lines
 */
export function isTopBusLine(routeCode: string): boolean {
  return TOP_BUS_LINES.includes(routeCode as TopBusLine);
}

/**
 * Default bus configuration for routes without specific config
 */
const DEFAULT_BUS_CONFIG: Omit<LineConfig, 'lineCode' | 'name'> = {
  color: '#DC241F', // TMB Bus red
  textColor: '#FFFFFF',
  headwaySeconds: 600, // 10 minutes default
  avgSpeedKmh: 15, // Average including stops and traffic
  dwellTimeSeconds: 20,
  stationCount: 20,
};

/**
 * High-frequency bus routes (shorter headways)
 * H-lines (horizontal), V-lines (vertical), D-lines (diagonal)
 */
const HIGH_FREQUENCY_PREFIXES = ['H', 'V', 'D'];

/**
 * Airport and night bus routes
 */
const AIRPORT_PREFIXES = ['A'];
const NIGHT_PREFIXES = ['N'];

/**
 * Get configuration for a bus route
 * Uses route prefix to determine headway category
 */
export function getBusRouteConfig(routeCode: string): LineConfig {
  const prefix = routeCode.charAt(0).toUpperCase();

  let headwaySeconds = DEFAULT_BUS_CONFIG.headwaySeconds;
  let avgSpeedKmh = DEFAULT_BUS_CONFIG.avgSpeedKmh;

  if (HIGH_FREQUENCY_PREFIXES.includes(prefix)) {
    // High-frequency network: 5-8 minute headways
    headwaySeconds = 360; // 6 minutes
    avgSpeedKmh = 14;
  } else if (AIRPORT_PREFIXES.includes(prefix)) {
    // Airport buses: less frequent but faster
    headwaySeconds = 720; // 12 minutes
    avgSpeedKmh = 25;
  } else if (NIGHT_PREFIXES.includes(prefix)) {
    // Night buses: longer headways
    headwaySeconds = 1200; // 20 minutes
    avgSpeedKmh = 18;
  }

  return {
    lineCode: routeCode,
    name: `Bus ${routeCode}`,
    color: DEFAULT_BUS_CONFIG.color,
    textColor: DEFAULT_BUS_CONFIG.textColor,
    headwaySeconds,
    avgSpeedKmh,
    dwellTimeSeconds: DEFAULT_BUS_CONFIG.dwellTimeSeconds,
    stationCount: DEFAULT_BUS_CONFIG.stationCount,
  };
}

/**
 * Calculate estimated number of buses for a route based on length and headway
 *
 * @param routeLengthMeters - Total length of the route in meters
 * @param routeCode - The bus route code
 * @returns Number of buses per direction
 */
export function calculateBusesPerDirection(
  routeLengthMeters: number,
  routeCode: string
): number {
  const config = getBusRouteConfig(routeCode);

  // Convert speed to m/s
  const avgSpeedMs = (config.avgSpeedKmh * 1000) / 3600;

  // Time to traverse full route
  const tripTimeSeconds = routeLengthMeters / avgSpeedMs;

  // Number of buses needed to maintain headway
  const buses = Math.ceil(tripTimeSeconds / config.headwaySeconds);

  // Minimum 1 bus per direction, max 10 for reasonable performance
  return Math.max(1, Math.min(buses, 10));
}

/**
 * Simulation update interval in milliseconds
 * Same as Metro for consistency
 */
export const BUS_SIMULATION_INTERVAL_MS = 5000;

/**
 * Interpolation duration for smooth position animation
 */
export const BUS_INTERPOLATION_DURATION_MS = 4500;
