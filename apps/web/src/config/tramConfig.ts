/**
 * Barcelona TRAM line configuration for position simulation
 *
 * TRAM operates two separate networks:
 * - Trambaix (T1, T2, T3): Western network serving Baix Llobregat
 * - Trambesòs (T4, T5, T6): Eastern network serving Besòs area
 *
 * Source: TRAM (www.tram.cat)
 */

import type { LineConfig } from '../types/transit';

/**
 * TRAM line configuration with schedule data
 *
 * Headways are peak-hour values (7-9am, 5-8pm weekdays).
 * TRAM services are less frequent than Metro.
 */
export const TRAM_LINE_CONFIG: Record<string, LineConfig> = {
  T1: {
    lineCode: 'T1',
    name: 'Bon Viatge - Francesc Macià',
    color: '#FF0D0D',
    textColor: '#FFFFFF',
    headwaySeconds: 360,      // 6 minutes peak
    avgSpeedKmh: 18,          // Trams are slower, share road space
    dwellTimeSeconds: 30,
    stationCount: 14,
  },
  T2: {
    lineCode: 'T2',
    name: 'Llevant Les Planes - Francesc Macià',
    color: '#80FF80',
    textColor: '#000000',
    headwaySeconds: 420,      // 7 minutes peak
    avgSpeedKmh: 18,
    dwellTimeSeconds: 30,
    stationCount: 16,
  },
  T3: {
    lineCode: 'T3',
    name: 'Sant Feliu Consell Comarcal - Francesc Macià',
    color: '#0074E8',
    textColor: '#FFFFFF',
    headwaySeconds: 420,      // 7 minutes peak
    avgSpeedKmh: 18,
    dwellTimeSeconds: 30,
    stationCount: 15,
  },
  T4: {
    lineCode: 'T4',
    name: 'Estació de Sant Adrià - Ciutadella/Vila Olímpica',
    color: '#008080',         // Official TRAM teal
    textColor: '#FFFFFF',
    headwaySeconds: 480,      // 8 minutes peak
    avgSpeedKmh: 20,
    dwellTimeSeconds: 30,
    stationCount: 13,
  },
  T5: {
    lineCode: 'T5',
    name: 'Glòries - Gorg',
    color: '#FF0080',         // Official TRAM pink
    textColor: '#000000',
    headwaySeconds: 480,      // 8 minutes peak
    avgSpeedKmh: 20,
    dwellTimeSeconds: 30,
    stationCount: 15,
  },
  T6: {
    lineCode: 'T6',
    name: 'Estació de Sant Adrià - Glòries',
    color: '#4B5BE9',         // Official TRAM blue
    textColor: '#FFFFFF',
    headwaySeconds: 480,      // 8 minutes peak
    avgSpeedKmh: 20,
    dwellTimeSeconds: 30,
    stationCount: 11,
  },
};

/**
 * Get all configured TRAM line codes
 */
export function getTramLineCodes(): string[] {
  return Object.keys(TRAM_LINE_CONFIG);
}

/**
 * Get configuration for a specific TRAM line
 */
export function getTramLineConfig(lineCode: string): LineConfig | undefined {
  return TRAM_LINE_CONFIG[lineCode];
}

/**
 * Calculate estimated number of trams for a line based on length and headway
 */
export function calculateTramsPerDirection(
  lineLengthMeters: number,
  lineCode: string
): number {
  const config = TRAM_LINE_CONFIG[lineCode];
  if (!config) return 0;

  const avgSpeedMs = (config.avgSpeedKmh * 1000) / 3600;
  const tripTimeSeconds = lineLengthMeters / avgSpeedMs;
  const trams = Math.ceil(tripTimeSeconds / config.headwaySeconds);

  return Math.max(1, trams);
}

/**
 * Simulation update interval in milliseconds
 */
export const TRAM_SIMULATION_INTERVAL_MS = 5000;

/**
 * Interpolation duration for smooth position animation
 */
export const TRAM_INTERPOLATION_DURATION_MS = 4500;
