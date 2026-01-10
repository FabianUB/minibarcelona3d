/**
 * Stop Layer Configuration Presets
 *
 * Network-specific configurations for GenericStopLayer.
 * Types and configs extracted to separate file for React Fast Refresh compatibility.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Circle radius configuration for zoom interpolation
 */
export interface CircleRadiusConfig {
  zoom10: number;
  zoom13: number;
  zoom15: number;
  zoom18: number;
}

/**
 * Stroke width configuration for zoom interpolation
 */
export interface StrokeWidthConfig {
  zoom10: number;
  zoom15: number;
  zoom18: number;
}

/**
 * Label text size configuration for zoom interpolation
 */
export interface LabelSizeConfig {
  zoom14: number;
  zoom16: number;
  zoom18: number;
}

/**
 * Opacity configuration for normal and highlight states
 */
export interface StopOpacityConfig {
  /** Normal circle opacity */
  circle: number;
  /** Normal stroke opacity */
  stroke: number;
  /** Highlighted circle opacity */
  highlightedCircle: number;
  /** Dimmed circle opacity */
  dimmedCircle: number;
}

/**
 * Configuration for a stop layer
 */
export interface StopLayerConfig {
  /** Unique source ID for Mapbox */
  sourceId: string;
  /** Circle layer ID */
  circleLayerId: string;
  /** Label layer ID */
  labelLayerId: string;
  /** Circle radius configuration */
  circleRadius: CircleRadiusConfig;
  /** Stroke width configuration */
  strokeWidth: StrokeWidthConfig;
  /** Label text size configuration */
  labelSize: LabelSizeConfig;
  /** Opacity configuration */
  opacity: StopOpacityConfig;
  /** Fallback color if primary_color not present */
  fallbackColor?: string;
  /** Minimum zoom for circle layer */
  circleMinZoom?: number;
  /** Minimum zoom for label layer */
  labelMinZoom: number;
  /** Zoom at which labels start appearing */
  labelStartZoom: number;
  /** Text offset for label */
  labelOffset: number;
  /** Allow text overlap at high zoom */
  textAllowOverlap?: boolean;
  /** Make text optional (can be hidden for space) */
  textOptional?: boolean;
}

// ============================================================================
// Default Configurations
// ============================================================================

const DEFAULT_CIRCLE_RADIUS: CircleRadiusConfig = {
  zoom10: 3,
  zoom13: 5,
  zoom15: 8,
  zoom18: 12,
};

const DEFAULT_STROKE_WIDTH: StrokeWidthConfig = {
  zoom10: 1,
  zoom15: 2,
  zoom18: 3,
};

const DEFAULT_LABEL_SIZE: LabelSizeConfig = {
  zoom14: 10,
  zoom16: 12,
  zoom18: 14,
};

const DEFAULT_OPACITY: StopOpacityConfig = {
  circle: 1,
  stroke: 1,
  highlightedCircle: 1,
  dimmedCircle: 0.4,
};

// ============================================================================
// Preset Configurations for Each Network
// ============================================================================

export const METRO_STOP_CONFIG: StopLayerConfig = {
  sourceId: 'metro-stations-source',
  circleLayerId: 'metro-stations-circles',
  labelLayerId: 'metro-stations-labels',
  circleRadius: DEFAULT_CIRCLE_RADIUS,
  strokeWidth: DEFAULT_STROKE_WIDTH,
  labelSize: DEFAULT_LABEL_SIZE,
  opacity: DEFAULT_OPACITY,
  labelMinZoom: 13.5,
  labelStartZoom: 14,
  labelOffset: 0.8,
  textAllowOverlap: true,
  textOptional: false,
};

export const BUS_STOP_CONFIG: StopLayerConfig = {
  sourceId: 'bus-stops-source',
  circleLayerId: 'bus-stops-circles',
  labelLayerId: 'bus-stops-labels',
  circleRadius: { zoom10: 2, zoom13: 3, zoom15: 5, zoom18: 8 },
  strokeWidth: { zoom10: 0.5, zoom15: 1, zoom18: 2 },
  labelSize: { zoom14: 9, zoom16: 10, zoom18: 12 },
  opacity: { circle: 0.8, stroke: 0.8, highlightedCircle: 0.8, dimmedCircle: 0.3 },
  circleMinZoom: 13,
  labelMinZoom: 15,
  labelStartZoom: 15,
  labelOffset: 0.6,
  textAllowOverlap: false,
  textOptional: true,
};

export const TRAM_STOP_CONFIG: StopLayerConfig = {
  sourceId: 'tram-stops-source',
  circleLayerId: 'tram-stops-circles',
  labelLayerId: 'tram-stops-labels',
  circleRadius: { zoom10: 3, zoom13: 5, zoom15: 7, zoom18: 10 },
  strokeWidth: DEFAULT_STROKE_WIDTH,
  labelSize: DEFAULT_LABEL_SIZE,
  opacity: DEFAULT_OPACITY,
  fallbackColor: '#009933', // TRAM green
  labelMinZoom: 13.5,
  labelStartZoom: 14,
  labelOffset: 0.8,
  textAllowOverlap: false,
  textOptional: true,
};

export const FGC_STOP_CONFIG: StopLayerConfig = {
  sourceId: 'fgc-stations-source',
  circleLayerId: 'fgc-stations-circles',
  labelLayerId: 'fgc-stations-labels',
  circleRadius: DEFAULT_CIRCLE_RADIUS,
  strokeWidth: DEFAULT_STROKE_WIDTH,
  labelSize: DEFAULT_LABEL_SIZE,
  opacity: DEFAULT_OPACITY,
  fallbackColor: '#e67300', // FGC orange
  labelMinZoom: 13.5,
  labelStartZoom: 14,
  labelOffset: 0.8,
  textAllowOverlap: false,
  textOptional: true,
};
