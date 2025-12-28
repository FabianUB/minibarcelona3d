/**
 * Barcelona Metro line configuration for position simulation
 *
 * Headway and speed data based on TMB published schedules.
 * Used to calculate simulated train positions.
 *
 * Source: TMB (Transports Metropolitans de Barcelona)
 */

import type { LineConfig } from '../types/transit';

/**
 * Metro line configuration with schedule data
 *
 * Headways are peak-hour values (7-9am, 5-8pm weekdays).
 * Off-peak headways are typically 1.5-2x these values.
 */
export const METRO_LINE_CONFIG: Record<string, LineConfig> = {
  L1: {
    lineCode: 'L1',
    name: 'Hospital de Bellvitge - Fondo',
    color: '#CE1126',
    textColor: '#FFFFFF',
    headwaySeconds: 180,      // 3 minutes peak
    avgSpeedKmh: 30,          // Including stops
    dwellTimeSeconds: 25,     // Time at each station
    stationCount: 30,
  },
  L2: {
    lineCode: 'L2',
    name: 'Paral·lel - Badalona Pompeu Fabra',
    color: '#93248F',
    textColor: '#FFFFFF',
    headwaySeconds: 240,      // 4 minutes peak
    avgSpeedKmh: 28,
    dwellTimeSeconds: 25,
    stationCount: 18,
  },
  L3: {
    lineCode: 'L3',
    name: 'Zona Universitària - Trinitat Nova',
    color: '#1EB53A',
    textColor: '#FFFFFF',
    headwaySeconds: 180,      // 3 minutes peak
    avgSpeedKmh: 30,
    dwellTimeSeconds: 25,
    stationCount: 26,
  },
  L4: {
    lineCode: 'L4',
    name: 'Trinitat Nova - La Pau',
    color: '#F7A30E',
    textColor: '#FFFFFF',
    headwaySeconds: 240,      // 4 minutes peak
    avgSpeedKmh: 28,
    dwellTimeSeconds: 25,
    stationCount: 22,
  },
  L5: {
    lineCode: 'L5',
    name: 'Cornellà Centre - Vall d\'Hebron',
    color: '#005A97',
    textColor: '#FFFFFF',
    headwaySeconds: 180,      // 3 minutes peak
    avgSpeedKmh: 30,
    dwellTimeSeconds: 25,
    stationCount: 26,
  },
  L9N: {
    lineCode: 'L9N',
    name: 'La Sagrera - Can Zam',
    color: '#FB712B',
    textColor: '#FFFFFF',
    headwaySeconds: 420,      // 7 minutes peak (automated line)
    avgSpeedKmh: 35,          // Faster automated trains
    dwellTimeSeconds: 20,
    stationCount: 12,
  },
  L9S: {
    lineCode: 'L9S',
    name: 'Zona Universitària - Aeroport T1',
    color: '#FB712B',
    textColor: '#FFFFFF',
    headwaySeconds: 420,      // 7 minutes peak (automated line)
    avgSpeedKmh: 40,          // Express sections to airport
    dwellTimeSeconds: 20,
    stationCount: 15,
  },
  L10N: {
    lineCode: 'L10N',
    name: 'La Sagrera - Gorg',
    color: '#00A6D6',
    textColor: '#FFFFFF',
    headwaySeconds: 420,      // 7 minutes peak (automated line)
    avgSpeedKmh: 35,
    dwellTimeSeconds: 20,
    stationCount: 12,
  },
  L10S: {
    lineCode: 'L10S',
    name: 'Zona Universitària - Collblanc',
    color: '#00A6D6',
    textColor: '#FFFFFF',
    headwaySeconds: 420,      // 7 minutes peak (automated line)
    avgSpeedKmh: 35,
    dwellTimeSeconds: 20,
    stationCount: 6,
  },
  L11: {
    lineCode: 'L11',
    name: 'Trinitat Nova - Can Cuiàs',
    color: '#89B94C',
    textColor: '#FFFFFF',
    headwaySeconds: 420,      // 7 minutes peak (automated light metro)
    avgSpeedKmh: 25,          // Short line, slower
    dwellTimeSeconds: 20,
    stationCount: 5,
  },
  FM: {
    lineCode: 'FM',
    name: 'Funicular de Montjuïc',
    color: '#004C38',
    textColor: '#FFFFFF',
    headwaySeconds: 600,      // 10 minutes (funicular)
    avgSpeedKmh: 15,          // Slow incline
    dwellTimeSeconds: 30,
    stationCount: 2,
  },
};

/**
 * Get all configured metro line codes
 */
export function getMetroLineCodes(): string[] {
  return Object.keys(METRO_LINE_CONFIG);
}

/**
 * Get configuration for a specific metro line
 */
export function getMetroLineConfig(lineCode: string): LineConfig | undefined {
  return METRO_LINE_CONFIG[lineCode];
}

/**
 * Calculate estimated number of trains for a line based on length and headway
 *
 * @param lineLengthMeters - Total length of the line in meters
 * @param lineCode - The metro line code
 * @returns Number of trains per direction
 */
export function calculateTrainsPerDirection(
  lineLengthMeters: number,
  lineCode: string
): number {
  const config = METRO_LINE_CONFIG[lineCode];
  if (!config) return 0;

  // Convert speed to m/s
  const avgSpeedMs = (config.avgSpeedKmh * 1000) / 3600;

  // Time to traverse full line
  const tripTimeSeconds = lineLengthMeters / avgSpeedMs;

  // Number of trains needed to maintain headway
  const trains = Math.ceil(tripTimeSeconds / config.headwaySeconds);

  // Minimum 1 train per direction
  return Math.max(1, trains);
}

/**
 * Simulation update interval in milliseconds
 * Position recalculated every 5 seconds for smooth animation
 */
export const METRO_SIMULATION_INTERVAL_MS = 5000;

/**
 * Interpolation duration for smooth position animation
 * Should match or be slightly less than simulation interval
 */
export const METRO_INTERPOLATION_DURATION_MS = 4500;
