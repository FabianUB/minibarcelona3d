/**
 * Algorithm types for train position calculation
 *
 * Defines types for switching between GPS-only and predictive positioning,
 * and for representing calculated positions with confidence metadata.
 *
 * Phase 1, Task T005
 */

/**
 * Position algorithm mode
 *
 * - 'gps-only': Use real-time GPS coordinates only (current behavior)
 * - 'predictive': Use schedule-based interpolation with station parking
 */
export type PositionAlgorithmMode = 'gps-only' | 'predictive';

/**
 * Position source indicator
 *
 * Identifies how a train's position was calculated:
 * - 'gps': Direct from GPS coordinates
 * - 'predicted': Interpolated from schedule/delay data
 * - 'blended': Weighted blend of GPS and predicted positions
 */
export type PositionSource = 'gps' | 'predicted' | 'blended';

/**
 * Calculated position with metadata
 *
 * Result from position calculation algorithms, includes:
 * - Position coordinates
 * - Bearing (orientation)
 * - Source of calculation
 * - Confidence score
 */
export interface CalculatedPosition {
  /**
   * Position as [longitude, latitude]
   * Follows Mapbox GL JS convention
   */
  position: [number, number];

  /**
   * Bearing in degrees (0-360, where 0 is North, 90 is East)
   */
  bearing: number;

  /**
   * How this position was calculated
   */
  source: PositionSource;

  /**
   * Confidence score (0-1)
   * - 1.0 = high confidence (recent GPS or accurate schedule)
   * - 0.5 = medium confidence (older GPS, blended)
   * - 0.0 = low confidence (stale data, fallback)
   */
  confidence: number;
}
