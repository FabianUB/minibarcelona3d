// Core domain types for the Rodalies map experience.

export type LngLat = [number, number];
export type BoundingBox = [number, number, number, number];

export type LinePattern = string;
export type ISO8601Timestamp = string;

export interface RodaliesLine {
  id: string;
  name: string;
  short_code: string;
  brand_color: string;
  default_pattern: LinePattern;
  high_contrast_pattern: LinePattern;
  order?: number;
}

export interface LineStringGeometry {
  type: 'LineString';
  coordinates: LngLat[];
}

export interface MultiLineStringGeometry {
  type: 'MultiLineString';
  coordinates: LngLat[][];
}

export type RodaliesLineGeometry = LineStringGeometry | MultiLineStringGeometry;

export interface RodaliesLineFeatureProperties {
  id: string;
  name: string;
  short_code: string;
  brand_color?: string;
  default_pattern?: LinePattern;
  high_contrast_pattern?: LinePattern;
}

export interface Feature<TProperties, TGeometry> {
  type: 'Feature';
  properties: TProperties;
  geometry: TGeometry;
}

export interface FeatureCollection<TFeature extends Feature<unknown, unknown>> {
  type: 'FeatureCollection';
  features: TFeature[];
}

export type RodaliesLineFeature = Feature<
  RodaliesLineFeatureProperties,
  RodaliesLineGeometry
>;

export interface LineGeometry {
  line_id: string;
  feature: RodaliesLineFeature;
  bbox: BoundingBox;
  last_verified_at: ISO8601Timestamp;
}

export interface PointGeometry {
  type: 'Point';
  coordinates: LngLat;
}

export interface StationFeatureProperties {
  id: string;
  name: string;
  code: string | null;
  lines: string[];
}

export type StationFeature = Feature<
  StationFeatureProperties,
  PointGeometry
>;

export interface Station {
  id: string;
  name: string;
  code: string | null;
  lines: string[];
  geometry: PointGeometry;
}

export interface MapViewport {
  center: { lat: number; lng: number };
  zoom: number;
  max_bounds: [LngLat, LngLat];
  padding: { top: number; right: number; bottom: number; left: number };
}

export interface LegendEntry {
  line_id: string;
  label: string;
  theme_tokens: {
    standard: LinePattern;
    high_contrast: LinePattern;
  };
  is_highlighted: boolean;
}

export type MapHighlightMode = 'none' | 'highlight' | 'isolate';

export type ActivePanel = 'none' | 'legend' | 'settings';

export interface MapUIState {
  selectedLineId: string | null; // Deprecated: kept for backwards compatibility
  selectedLineIds: string[]; // New: support multiple line selection
  highlightMode: MapHighlightMode;
  isHighContrast: boolean;
  isLegendOpen: boolean; // Deprecated: use activePanel instead
  activePanel: ActivePanel; // Which panel is currently expanded on desktop
}

export interface ManifestLineEntry {
  id: string;
  checksum: string;
  path: string;
}

export interface StationsEntry {
  path: string;
  checksum: string;
}

export interface RodaliesManifest {
  updated_at: ISO8601Timestamp;
  viewport: MapViewport;
  lines: ManifestLineEntry[];
  stations: StationsEntry;
  rodalies_lines_path?: string;
  legend_entries_path?: string;
  line_geometries_path?: string;
  map_viewport_path?: string;
  map_ui_state_path?: string;
}

export type RodaliesLineCollection =
  FeatureCollection<RodaliesLineFeature>;
export type StationFeatureCollection =
  FeatureCollection<StationFeature>;
export type LineGeometryCollection =
  FeatureCollection<RodaliesLineFeature>;
