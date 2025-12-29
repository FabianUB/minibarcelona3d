/**
 * Type definitions for real-time transit vehicle positioning
 *
 * Shared types for Metro, Bus, and potentially other transit vehicles.
 * Designed to work with schedule-based position simulation (Metro)
 * and API-based position estimation (Bus via iBus).
 */

import type { TransportType } from './rodalies';

// Re-export TransportType for convenience
export type { TransportType };

/**
 * How the vehicle position was determined
 */
export type PositionSource = 'gps' | 'schedule' | 'ibus' | 'interpolated';

/**
 * Confidence level of the position estimate
 * - high: Real-time data, recent update
 * - medium: Schedule-based or older data
 * - low: Fallback or stale data
 */
export type PositionConfidence = 'high' | 'medium' | 'low';

/**
 * Vehicle movement status
 */
export type VehicleStatus = 'IN_TRANSIT_TO' | 'STOPPED_AT' | 'ARRIVING';

/**
 * Direction of travel along the line
 * 0 = outbound (first direction), 1 = inbound (return direction)
 */
export type TravelDirection = 0 | 1;

/**
 * Unified vehicle position for all transit types
 *
 * Works for:
 * - Metro: Schedule-simulated positions
 * - Bus: iBus API-estimated positions
 * - Future: Tram, FGC, etc.
 */
export interface VehiclePosition {
  // Identity
  vehicleKey: string;           // Unique ID: "metro-L1-0-5" or "bus-H6-042"
  networkType: TransportType;   // 'metro' | 'bus' | 'rodalies'
  lineCode: string;             // "L1", "H6", "R1"
  routeId?: string;             // Full route identifier if available

  // Position (always present - calculated or estimated)
  latitude: number;
  longitude: number;
  bearing: number;              // Direction in degrees (0-360, 0=North)

  // Position metadata
  source: PositionSource;       // How position was determined
  confidence: PositionConfidence;
  estimatedAt: number;          // Timestamp when position was calculated

  // Direction
  direction: TravelDirection;   // 0=outbound, 1=inbound

  // Transit context
  previousStopId: string | null;
  nextStopId: string | null;
  previousStopName: string | null;
  nextStopName: string | null;
  status: VehicleStatus;

  // Progress along segment
  progressFraction: number;     // 0.0-1.0 between previous and next stop
  distanceAlongLine: number;    // Meters from start of line

  // Continuous motion parameters (for smooth per-frame animation)
  speedMetersPerSecond: number; // Vehicle speed in m/s
  lineTotalLength: number;      // Total length of line in meters

  // Timing (optional, for iBus-based)
  arrivalMinutes?: number;      // Minutes until next stop (from iBus)

  // Visual
  lineColor: string;            // Hex color for the line
}

/**
 * Configuration for a metro/transit line
 */
export interface LineConfig {
  lineCode: string;
  name: string;
  color: string;
  textColor: string;
  headwaySeconds: number;       // Time between trains/buses
  avgSpeedKmh: number;          // Average speed for distance calculations
  dwellTimeSeconds: number;     // Time stopped at stations
  stationCount: number;         // Number of stations on the line
}

/**
 * Result from position simulation/estimation
 */
export interface PositionGenerationResult {
  positions: VehiclePosition[];
  generatedAt: number;
  lineCode: string;
  vehicleCount: number;
}

/**
 * Animation state for smooth position interpolation
 */
export interface VehicleAnimationState {
  vehicleKey: string;
  currentPosition: [number, number];  // [lng, lat]
  targetPosition: [number, number];   // [lng, lat]
  currentBearing: number;
  targetBearing: number;
  lastUpdate: number;                 // Timestamp
  interpolationDuration: number;      // ms
}

/**
 * Mesh data for 3D vehicle rendering
 */
export interface VehicleMeshData {
  vehicleKey: string;
  lineCode: string;
  networkType: TransportType;
  direction: TravelDirection;
  position: [number, number];
  bearing: number;
  lineColor: string;
  opacity: number;
  lastUpdate: number;
}
