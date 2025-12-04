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
 * Using any for Mapbox GL expression types which can be complex nested arrays
 */
export interface StationMarkerStyles {
  'circle-radius': any; // eslint-disable-line @typescript-eslint/no-explicit-any
  'circle-color': any; // eslint-disable-line @typescript-eslint/no-explicit-any
  'circle-opacity': any; // eslint-disable-line @typescript-eslint/no-explicit-any
  'circle-stroke-width': any; // eslint-disable-line @typescript-eslint/no-explicit-any
  'circle-stroke-color': any; // eslint-disable-line @typescript-eslint/no-explicit-any
  'circle-blur'?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  'circle-translate'?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const STATION_MARKER_COLOR = '#000000';
// Keep the markers seated on the ground plane at large zoom levels so
// trains appear to dock on top of the station symbol.
const ELEVATE_TRANSLATE: any = ['literal', [0, 0]]; // eslint-disable-line @typescript-eslint/no-explicit-any

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
  const maxOpacity = isDimmed ? 0.3 : 1.0;
  return {
    'circle-radius': [
      'interpolate',
      ['linear'],
      ['zoom'],
      10,
      ['case', ['get', 'isMultiLine'], 18, 15],
      15,
      ['case', ['get', 'isMultiLine'], 22, 16],
      18.5,
      ['case', ['get', 'isMultiLine'], 30, 22],
    ],
    'circle-color': STATION_MARKER_COLOR,
    'circle-opacity': [
      'interpolate',
      ['linear'],
      ['zoom'],
      10,
      0,
      15,
      maxOpacity,
    ],
    'circle-stroke-width': ['case', ['get', 'isMultiLine'], 3, 2],
    'circle-stroke-color': isHighlighted ? '#FFD700' : '#FFFFFF',
    'circle-blur': 0.15, // Subtle glow effect to stand out from trains
    'circle-translate': ELEVATE_TRANSLATE,
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
      ['linear'],
      ['zoom'],
      10,
      10,
      15,
      12,
      18.5,
      16,
    ],
    'circle-color': '#FFFFFF',
    'circle-opacity': [
      'interpolate',
      ['linear'],
      ['zoom'],
      10,
      0,
      15,
      1,
    ],
    'circle-stroke-width': 1,
    'circle-stroke-color': STATION_MARKER_COLOR,
    'circle-translate': ELEVATE_TRANSLATE,
  };
}
