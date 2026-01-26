/**
 * Line Layer Configuration Presets
 *
 * Network-specific configurations for GenericLineLayer.
 * Types and configs extracted to separate file for React Fast Refresh compatibility.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Line width configuration for zoom interpolation
 */
export interface LineWidthConfig {
  /** Width at zoom 10 */
  zoom10: number;
  /** Width at zoom 13 */
  zoom13: number;
  /** Width at zoom 15 */
  zoom15: number;
  /** Width at zoom 18 */
  zoom18: number;
}

/**
 * Opacity configuration for normal and highlight states
 */
export interface OpacityConfig {
  /** Normal line opacity (no highlight) */
  line: number;
  /** Normal casing opacity */
  casing: number;
  /** Highlighted line opacity */
  highlightedLine: number;
  /** Non-highlighted line opacity in highlight mode */
  dimmedLine: number;
  /** Highlighted casing opacity */
  highlightedCasing: number;
  /** Non-highlighted casing opacity in isolate mode */
  dimmedCasing: number;
}

/**
 * Configuration for a line layer
 */
export interface LineLayerConfig {
  /** Unique source ID for Mapbox */
  sourceId: string;
  /** Main line layer ID */
  lineLayerId: string;
  /** Casing layer ID */
  casingLayerId: string;
  /** GeoJSON property name for line/route code */
  lineCodeProperty: string;
  /** GeoJSON property name for line color (default: 'color') */
  colorProperty?: string;
  /** Line width configuration */
  lineWidth: LineWidthConfig;
  /** Casing width configuration */
  casingWidth: LineWidthConfig;
  /** Opacity configuration */
  opacity: OpacityConfig;
}

// ============================================================================
// Default Configurations
// ============================================================================

const DEFAULT_LINE_WIDTH: LineWidthConfig = {
  zoom10: 2,
  zoom13: 3,
  zoom15: 5,
  zoom18: 10,
};

const DEFAULT_CASING_WIDTH: LineWidthConfig = {
  zoom10: 3,
  zoom13: 5,
  zoom15: 8,
  zoom18: 14,
};

const DEFAULT_OPACITY: OpacityConfig = {
  line: 0.9,
  casing: 0.8,
  highlightedLine: 0.95,
  dimmedLine: 0.2,
  highlightedCasing: 0.8,
  dimmedCasing: 0.1,
};

// ============================================================================
// Preset Configurations for Each Network
// ============================================================================

export const METRO_LINE_CONFIG: LineLayerConfig = {
  sourceId: 'metro-lines-source',
  lineLayerId: 'metro-lines',
  casingLayerId: 'metro-lines-casing',
  lineCodeProperty: 'line_code',
  lineWidth: DEFAULT_LINE_WIDTH,
  casingWidth: DEFAULT_CASING_WIDTH,
  opacity: DEFAULT_OPACITY,
};

export const BUS_LINE_CONFIG: LineLayerConfig = {
  sourceId: 'bus-routes-source',
  lineLayerId: 'bus-routes',
  casingLayerId: 'bus-routes-casing',
  lineCodeProperty: 'route_code',
  lineWidth: { zoom10: 1, zoom13: 2, zoom15: 3, zoom18: 6 },
  casingWidth: { zoom10: 2, zoom13: 3, zoom15: 5, zoom18: 10 },
  opacity: {
    line: 0.7,
    casing: 0.6,
    highlightedLine: 0.85,
    dimmedLine: 0.15,
    highlightedCasing: 0.6,
    dimmedCasing: 0.1,
  },
};

export const TRAM_LINE_CONFIG: LineLayerConfig = {
  sourceId: 'tram-lines-source',
  lineLayerId: 'tram-lines',
  casingLayerId: 'tram-lines-casing',
  lineCodeProperty: 'line_code',
  lineWidth: DEFAULT_LINE_WIDTH,
  casingWidth: DEFAULT_CASING_WIDTH,
  opacity: DEFAULT_OPACITY,
};

export const FGC_LINE_CONFIG: LineLayerConfig = {
  sourceId: 'fgc-lines-source',
  lineLayerId: 'fgc-lines',
  casingLayerId: 'fgc-lines-casing',
  lineCodeProperty: 'line_code',
  lineWidth: DEFAULT_LINE_WIDTH,
  casingWidth: DEFAULT_CASING_WIDTH,
  opacity: DEFAULT_OPACITY,
};

export const RODALIES_LINE_CONFIG: LineLayerConfig = {
  sourceId: 'rodalies-lines',
  lineLayerId: 'rodalies-lines-outline',
  casingLayerId: 'rodalies-lines-casing',
  lineCodeProperty: 'id',
  colorProperty: 'brand_color',
  lineWidth: {
    zoom10: 2,
    zoom13: 4,
    zoom15: 6,
    zoom18: 10,
  },
  casingWidth: {
    zoom10: 3,
    zoom13: 6,
    zoom15: 9,
    zoom18: 14,
  },
  opacity: DEFAULT_OPACITY,
};
