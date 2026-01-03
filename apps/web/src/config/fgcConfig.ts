/**
 * FGC (Ferrocarrils de la Generalitat de Catalunya) line configuration
 *
 * FGC operates several networks:
 * - Barcelona-Vallès: L6, L7, L12, S1, S2, S5, S55
 * - Llobregat-Anoia: L8, R5, R6, R50, R60, S4, S8, S9
 * - Urban Metro lines: L6, L7, L8, L12
 *
 * Source: FGC (www.fgc.cat)
 */

import type { LineConfig } from '../types/transit';

/**
 * FGC line configuration with schedule data
 */
export const FGC_LINE_CONFIG: Record<string, LineConfig> = {
  // Barcelona-Vallès Urban Lines
  L6: {
    lineCode: 'L6',
    name: 'Plaça Catalunya - Reina Elisenda',
    color: '#7D4698',
    textColor: '#FFFFFF',
    headwaySeconds: 300,      // 5 minutes peak
    avgSpeedKmh: 25,
    dwellTimeSeconds: 25,
    stationCount: 9,
  },
  L7: {
    lineCode: 'L7',
    name: 'Plaça Catalunya - Avinguda Tibidabo',
    color: '#A05A2C',
    textColor: '#FFFFFF',
    headwaySeconds: 300,      // 5 minutes peak
    avgSpeedKmh: 25,
    dwellTimeSeconds: 25,
    stationCount: 7,
  },
  L8: {
    lineCode: 'L8',
    name: 'Plaça Espanya - Molí Nou Ciutat Cooperativa',
    color: '#FF87C8',
    textColor: '#000000',
    headwaySeconds: 360,      // 6 minutes peak
    avgSpeedKmh: 30,
    dwellTimeSeconds: 25,
    stationCount: 12,
  },
  L12: {
    lineCode: 'L12',
    name: 'Sarrià - Reina Elisenda',
    color: '#C4A7E7',
    textColor: '#000000',
    headwaySeconds: 600,      // 10 minutes
    avgSpeedKmh: 20,
    dwellTimeSeconds: 25,
    stationCount: 3,
  },
  // Barcelona-Vallès Suburban Lines
  S1: {
    lineCode: 'S1',
    name: 'Plaça Catalunya - Terrassa Rambla',
    color: '#E37222',
    textColor: '#FFFFFF',
    headwaySeconds: 600,      // 10 minutes peak
    avgSpeedKmh: 45,
    dwellTimeSeconds: 30,
    stationCount: 20,
  },
  S2: {
    lineCode: 'S2',
    name: 'Plaça Catalunya - Sabadell Rambla',
    color: '#88BB0B',
    textColor: '#FFFFFF',
    headwaySeconds: 600,      // 10 minutes peak
    avgSpeedKmh: 45,
    dwellTimeSeconds: 30,
    stationCount: 18,
  },
  S3: {
    lineCode: 'S3',
    name: 'Plaça Catalunya - Can Ros',
    color: '#CE1126',
    textColor: '#FFFFFF',
    headwaySeconds: 900,      // 15 minutes
    avgSpeedKmh: 40,
    dwellTimeSeconds: 30,
    stationCount: 10,
  },
  S4: {
    lineCode: 'S4',
    name: 'Plaça Catalunya - Olesa de Montserrat',
    color: '#CE1126',
    textColor: '#FFFFFF',
    headwaySeconds: 1200,     // 20 minutes
    avgSpeedKmh: 50,
    dwellTimeSeconds: 30,
    stationCount: 25,
  },
  // Llobregat-Anoia Lines
  S8: {
    lineCode: 'S8',
    name: 'Plaça Espanya - Martorell Enllaç',
    color: '#49C0DE',
    textColor: '#000000',
    headwaySeconds: 900,      // 15 minutes peak
    avgSpeedKmh: 40,
    dwellTimeSeconds: 30,
    stationCount: 14,
  },
  S9: {
    lineCode: 'S9',
    name: 'Plaça Espanya - Quatre Camins',
    color: '#DF4661',
    textColor: '#FFFFFF',
    headwaySeconds: 900,      // 15 minutes
    avgSpeedKmh: 35,
    dwellTimeSeconds: 30,
    stationCount: 8,
  },
  R5: {
    lineCode: 'R5',
    name: 'Plaça Espanya - Manresa',
    color: '#00738A',
    textColor: '#FFFFFF',
    headwaySeconds: 1800,     // 30 minutes (regional)
    avgSpeedKmh: 55,
    dwellTimeSeconds: 45,
    stationCount: 30,
  },
  R6: {
    lineCode: 'R6',
    name: 'Plaça Espanya - Igualada',
    color: '#00738A',
    textColor: '#FFFFFF',
    headwaySeconds: 1800,     // 30 minutes (regional)
    avgSpeedKmh: 50,
    dwellTimeSeconds: 45,
    stationCount: 28,
  },
  R50: {
    lineCode: 'R50',
    name: 'Plaça Espanya - Manresa (semi-direct)',
    color: '#00738A',
    textColor: '#FFFFFF',
    headwaySeconds: 3600,     // 60 minutes (express)
    avgSpeedKmh: 65,
    dwellTimeSeconds: 30,
    stationCount: 15,
  },
  R60: {
    lineCode: 'R60',
    name: 'Plaça Espanya - Igualada (semi-direct)',
    color: '#00738A',
    textColor: '#FFFFFF',
    headwaySeconds: 3600,     // 60 minutes (express)
    avgSpeedKmh: 60,
    dwellTimeSeconds: 30,
    stationCount: 12,
  },
  // Funiculars
  FV: {
    lineCode: 'FV',
    name: 'Funicular de Vallvidrera',
    color: '#0A57A3',
    textColor: '#FFFFFF',
    headwaySeconds: 600,      // 10 minutes
    avgSpeedKmh: 15,
    dwellTimeSeconds: 45,
    stationCount: 2,
  },
};

/**
 * Get all configured FGC line codes
 */
export function getFgcLineCodes(): string[] {
  return Object.keys(FGC_LINE_CONFIG);
}

/**
 * Get configuration for a specific FGC line
 */
export function getFgcLineConfig(lineCode: string): LineConfig | undefined {
  return FGC_LINE_CONFIG[lineCode];
}

/**
 * Calculate estimated number of trains for a line based on length and headway
 */
export function calculateFgcTrainsPerDirection(
  lineLengthMeters: number,
  lineCode: string
): number {
  const config = FGC_LINE_CONFIG[lineCode];
  if (!config) return 0;

  const avgSpeedMs = (config.avgSpeedKmh * 1000) / 3600;
  const tripTimeSeconds = lineLengthMeters / avgSpeedMs;
  const trains = Math.ceil(tripTimeSeconds / config.headwaySeconds);

  return Math.max(1, trains);
}

/**
 * Simulation update interval in milliseconds
 */
export const FGC_SIMULATION_INTERVAL_MS = 5000;

/**
 * Interpolation duration for smooth position animation
 */
export const FGC_INTERPOLATION_DURATION_MS = 4500;
