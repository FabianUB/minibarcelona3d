/**
 * Component Interface Contracts
 * Feature: 004-station-visualization
 *
 * TypeScript interfaces defining component props and hook return types.
 * These contracts ensure consistent API across the station feature.
 */

import type { Station, RodaliesLine } from '../../../apps/web/src/types/rodalies';
import type { Map as MapboxMap } from 'mapbox-gl';

// ============================================================================
// StationLayer Component
// ============================================================================

/**
 * StationLayer - Mapbox GL layer rendering station markers
 *
 * Responsibilities:
 * - Load station data via dataLoader
 * - Add Mapbox GL source + layers for station markers
 * - Handle click/hover events on markers
 * - Apply radial offset positioning for overlapping stations
 * - Integrate with line highlighting system
 *
 * Acceptance Criteria:
 * - FR-001: Display all stations from Station.geojson
 * - FR-004: Visually differentiate single vs multi-line stations
 * - FR-012: Prevent overlapping via radial offset
 * - SC-003: Maintain 30+ FPS with 200+ stations
 */
export interface StationLayerProps {
  /** Mapbox GL map instance (must be loaded) */
  map: MapboxMap;

  /** Currently highlighted line IDs (from MapStateProvider) */
  highlightedLineIds: string[];

  /** Highlight mode: 'none' | 'highlight' | 'isolate' */
  highlightMode: 'none' | 'highlight' | 'isolate';

  /** Callback when user clicks a station marker */
  onStationClick: (stationId: string) => void;

  /** Callback when user hovers over a station marker (desktop only) */
  onStationHover?: (stationId: string | null) => void;

  /** Optional: Override default layer IDs (for testing) */
  layerIds?: {
    source: string;
    circles: string;
    circlesMultiOuter: string;
    circlesMultiInner: string;
  };
}

// ============================================================================
// StationInfoPanel Component
// ============================================================================

/**
 * StationInfoPanel - Detail panel displaying station information
 *
 * Responsibilities:
 * - Render station name, code, and serving lines
 * - Display line badges with brand colors
 * - Handle panel close actions (X button, outside click, Escape)
 * - Responsive layout (desktop vs mobile variants)
 *
 * Acceptance Criteria:
 * - FR-006: Display station name, code, serving lines
 * - FR-007: Show visual line indicators with colors
 * - FR-008: Close via explicit action or outside click
 * - FR-013: Responsive on desktop and mobile
 * - SC-008: Readable on 320px+ viewports
 */
export interface StationInfoPanelProps {
  /** Station data to display (null = panel closed) */
  station: Station | null;

  /** Line metadata for color/name display */
  lines: RodaliesLine[];

  /** Whether panel is open */
  isOpen: boolean;

  /** Callback when user closes the panel */
  onClose: () => void;

  /** Optional: Custom CSS class for styling */
  className?: string;
}

/**
 * StationInfoPanelDesktop - Desktop variant (>768px)
 * Fixed position bottom-right, 360px width
 */
export interface StationInfoPanelDesktopProps extends StationInfoPanelProps {
  /** Desktop-specific positioning (default: bottom-right) */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

/**
 * StationInfoPanelMobile - Mobile variant (<768px)
 * Bottom sheet behavior, full-width
 */
export interface StationInfoPanelMobileProps extends StationInfoPanelProps {
  /** Mobile-specific: Max height (% of viewport) */
  maxHeightPercent?: number; // Default: 60
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * useStationMarkers - Hook for station marker rendering logic
 *
 * Responsibilities:
 * - Compute radial offsets for overlapping stations
 * - Generate GeoJSON FeatureCollection for Mapbox source
 * - Provide marker styling based on line count and highlighting
 *
 * Returns:
 * - geoJSON: FeatureCollection ready for Mapbox source
 * - isLoading: Whether station data is loading
 * - error: Error message if load failed (null if success)
 */
export interface UseStationMarkersReturn {
  /** GeoJSON FeatureCollection with station markers */
  geoJSON: {
    type: 'FeatureCollection';
    features: Array<{
      type: 'Feature';
      id: string;
      properties: {
        id: string;
        name: string;
        code: string | null;
        lines: string[];
        isMultiLine: boolean;
        dominantLineColor: string;
        lineCount: number;
        offsetX?: number;
        offsetY?: number;
      };
      geometry: {
        type: 'Point';
        coordinates: [number, number];
      };
    }>;
  } | null;

  /** Loading state */
  isLoading: boolean;

  /** Error message (null if no error) */
  error: string | null;

  /** Retry failed load */
  retry: () => void;
}

export interface UseStationMarkersParams {
  /** Mapbox GL map instance */
  map: MapboxMap | null;

  /** Highlighted line IDs (filters visible stations) */
  highlightedLineIds: string[];

  /** Highlight mode */
  highlightMode: 'none' | 'highlight' | 'isolate';
}

/**
 * useStationHover - Hook for hover tooltip management
 *
 * Responsibilities:
 * - Create and manage Mapbox GL Popup for hover tooltips
 * - Debounce mousemove events (200ms)
 * - Show station name on hover (line count after 500ms)
 * - Hide on mouseleave or map interaction
 *
 * Returns:
 * - hoveredStationId: ID of currently hovered station (null if none)
 */
export interface UseStationHoverReturn {
  /** ID of currently hovered station */
  hoveredStationId: string | null;
}

export interface UseStationHoverParams {
  /** Mapbox GL map instance */
  map: MapboxMap | null;

  /** Station layer ID to listen for hover events */
  layerId: string;

  /** Whether hover is enabled (false on mobile) */
  enabled: boolean;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * calculateRadialOffsets - Compute pixel offsets for overlapping stations
 *
 * @param stations - Array of stations to position
 * @param map - Mapbox GL map instance (for pixel projection)
 * @returns Array of station offsets
 *
 * Algorithm:
 * 1. Project all station coordinates to screen pixels
 * 2. Detect overlapping stations (< 20px separation)
 * 3. Group overlapping stations by proximity
 * 4. Compute radial offsets for each group (polar coordinates)
 * 5. Return offset in pixels
 *
 * Acceptance Criteria:
 * - FR-012: Prevent overlapping via radial offset
 * - SC-007: Zero overlap at any zoom level
 */
export interface StationOffset {
  stationId: string;
  offsetX: number; // Pixels east (+) or west (-)
  offsetY: number; // Pixels south (+) or north (-)
}

export type CalculateRadialOffsets = (
  stations: Station[],
  map: MapboxMap
) => StationOffset[];

/**
 * getStationMarkerStyles - Generate Mapbox GL paint properties
 *
 * @param isHighlighted - Whether station's lines are highlighted
 * @param isDimmed - Whether station should be dimmed (other lines highlighted)
 * @returns Mapbox GL paint property expressions
 *
 * Acceptance Criteria:
 * - FR-004: Differentiate single vs multi-line stations
 * - FR-010: Respond to line highlighting
 */
export interface StationMarkerStyles {
  /** Circle radius (zoom-interpolated) */
  'circle-radius': any; // Mapbox GL expression

  /** Circle color (data-driven by dominantLineColor) */
  'circle-color': any;

  /** Circle opacity (1.0 normal, 0.3 dimmed) */
  'circle-opacity': any;

  /** Circle stroke width */
  'circle-stroke-width': any;

  /** Circle stroke color */
  'circle-stroke-color': any;
}

export type GetStationMarkerStyles = (
  isHighlighted: boolean,
  isDimmed: boolean
) => StationMarkerStyles;

// ============================================================================
// State Management (MapStateProvider extensions)
// ============================================================================

/**
 * Station-related actions added to MapActions
 */
export interface StationActions {
  /** Select a station (opens detail panel) */
  selectStation: (stationId: string | null) => void;

  /** Retry loading station data after failure */
  retryStationLoad: () => void;
}

/**
 * Station-related state added to MapUIState
 */
export interface StationState {
  /** Currently selected station ID */
  selectedStationId: string | null;

  /** Error message from station load failure */
  stationLoadError: string | null;
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Mapbox GL event handler for station marker clicks
 *
 * Acceptance Criteria:
 * - FR-005: Click/tap any marker to view details
 * - FR-016: Cancel pending updates on rapid clicks
 */
export type StationClickHandler = (e: {
  features?: Array<{
    properties: {
      id: string;
      name: string;
      code: string | null;
      lines: string[];
    };
  }>;
  lngLat: { lng: number; lat: number };
}) => void;

/**
 * Mapbox GL event handler for station marker hover
 *
 * Acceptance Criteria:
 * - FR-009: Show hover tooltip on desktop
 * - SC-005: Tooltip appears within 100ms
 */
export type StationHoverHandler = (e: {
  features?: Array<{
    properties: {
      id: string;
      name: string;
    };
  }>;
  lngLat: { lng: number; lat: number };
}) => void;

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Mock station data for testing
 */
export const MOCK_STATIONS: Station[] = [
  {
    id: '79101',
    name: 'Barcelona Sants',
    code: '79101',
    lines: ['R1', 'R2', 'R3', 'R4'],
    geometry: {
      type: 'Point',
      coordinates: [2.140833, 41.379167],
    },
  },
  {
    id: '79102',
    name: 'Passeig de Gràcia',
    code: null,
    lines: ['R2'],
    geometry: {
      type: 'Point',
      coordinates: [2.161667, 41.395833],
    },
  },
];

/**
 * Mock Mapbox GL map for testing
 */
export interface MockMapboxMap {
  on: jest.Mock;
  off: jest.Mock;
  addSource: jest.Mock;
  addLayer: jest.Mock;
  removeLayer: jest.Mock;
  removeSource: jest.Mock;
  project: jest.Mock; // Convert LngLat to Point
  unproject: jest.Mock; // Convert Point to LngLat
  queryRenderedFeatures: jest.Mock;
}
