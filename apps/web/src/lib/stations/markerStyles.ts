/**
 * Station Marker Style Utilities
 * Feature: 004-station-visualization
 *
 * Provides Mapbox GL paint properties for station markers.
 * Handles visual differentiation between single-line and multi-line stations,
 * and integrates with the line highlighting system.
 */

/**
 * Mapbox GL paint properties for station markers
 */
export interface StationMarkerStyles {
  'circle-radius': any;
  'circle-color': any;
  'circle-opacity': any;
  'circle-stroke-width': any;
  'circle-stroke-color': any;
  'circle-blur'?: any;
}

/**
 * Generate Mapbox GL paint properties for station markers
 *
 * Visual design:
 * - Single-line stations: Smaller circles (6-16px)
 * - Multi-line stations: Larger circles (8-20px)
 * - Highlighted: Gold stroke (#FFD700)
 * - Dimmed: 30% opacity
 * - Normal: 100% opacity
 *
 * @param isHighlighted - Whether station's lines are highlighted
 * @param isDimmed - Whether station should be dimmed (other lines highlighted)
 * @returns Mapbox GL paint property expressions
 *
 * Acceptance Criteria:
 * - FR-004: Differentiate single vs multi-line stations
 * - FR-010: Respond to line highlighting
 *
 * Tasks: T013
 */
export function getStationMarkerStyles(
  isHighlighted: boolean,
  isDimmed: boolean
): StationMarkerStyles {
  return {
    'circle-radius': [
      'interpolate',
      ['exponential', 1.5],
      ['zoom'],
      8,
      ['case', ['get', 'isMultiLine'], 8, 6],
      16,
      ['case', ['get', 'isMultiLine'], 20, 16],
    ],
    'circle-color': ['get', 'dominantLineColor'],
    'circle-opacity': isDimmed ? 0.3 : 1.0,
    'circle-stroke-width': ['case', ['get', 'isMultiLine'], 3, 2],
    'circle-stroke-color': isHighlighted ? '#FFD700' : '#FFFFFF',
    'circle-blur': 0.15, // Subtle glow effect to stand out from trains
  };
}

/**
 * Generate Mapbox GL paint properties for multi-line inner circles
 *
 * Multi-line stations use a concentric circle design:
 * - Outer circle: Dominant line color (from getStationMarkerStyles)
 * - Inner circle: White with colored stroke (this function)
 *
 * This creates a "donut" effect that clearly distinguishes multi-line
 * stations from single-line stations.
 *
 * @returns Mapbox GL paint property expressions
 *
 * Acceptance Criteria:
 * - FR-004: Visually differentiate multi-line stations
 *
 * Tasks: T014
 */
export function getMultiLineInnerCircleStyles(): StationMarkerStyles {
  return {
    'circle-radius': [
      'interpolate',
      ['exponential', 1.5],
      ['zoom'],
      8,
      5,
      16,
      14,
    ],
    'circle-color': '#FFFFFF',
    'circle-opacity': 1.0,
    'circle-stroke-width': 1,
    'circle-stroke-color': ['get', 'dominantLineColor'],
  };
}
