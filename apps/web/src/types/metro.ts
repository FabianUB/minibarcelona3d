// Type definitions for Barcelona Metro visualization

import type { Feature, FeatureCollection, LineStringGeometry, PointGeometry } from './rodalies';

/**
 * Metro line metadata
 */
export interface MetroLine {
  id: string;
  lineCode: string;
  name: string;
  color: string;
  textColor: string;
}

/**
 * Properties for Metro station GeoJSON features
 */
export interface MetroStationFeatureProperties {
  id: string;
  name: string;
  stop_code: string | null;
  lines: string[];
  primary_color: string;
  colors: string[];
}

/**
 * Properties for Metro line geometry GeoJSON features
 */
export interface MetroLineFeatureProperties {
  route_id: string;
  line_code: string;
  name: string;
  color: string;
  text_color: string;
}

export type MetroStationFeature = Feature<MetroStationFeatureProperties, PointGeometry>;
export type MetroLineFeature = Feature<MetroLineFeatureProperties, LineStringGeometry>;

export type MetroStationCollection = FeatureCollection<MetroStationFeature>;
export type MetroLineCollection = FeatureCollection<MetroLineFeature>;

/**
 * TMB manifest structure
 */
export interface TmbManifestFile {
  type: 'metro_stations' | 'metro_line' | 'bus_stops' | 'bus_route' | 'tram_stations' | 'tram_line' | 'fgc_stations' | 'fgc_line';
  path: string;
  line_code?: string;
  route_code?: string;
}

export interface TmbManifest {
  network: string;
  generated_at: string;
  files: TmbManifestFile[];
}

/**
 * All Metro lines with their official colors
 */
export const METRO_LINES: MetroLine[] = [
  { id: '1.1.1', lineCode: 'L1', name: 'Hospital de Bellvitge - Fondo', color: '#CE1126', textColor: '#FFFFFF' },
  { id: '1.2.1', lineCode: 'L2', name: 'Paral·lel - Badalona Pompeu Fabra', color: '#93248F', textColor: '#FFFFFF' },
  { id: '1.3.1', lineCode: 'L3', name: 'Zona Universitària - Trinitat Nova', color: '#1EB53A', textColor: '#FFFFFF' },
  { id: '1.4.1', lineCode: 'L4', name: 'Trinitat Nova - La Pau', color: '#F7A30E', textColor: '#FFFFFF' },
  { id: '1.5.1', lineCode: 'L5', name: 'Cornellà Centre - Vall d\'Hebron', color: '#005A97', textColor: '#FFFFFF' },
  { id: '1.9.1', lineCode: 'L9N', name: 'La Sagrera - Can Zam', color: '#FB712B', textColor: '#FFFFFF' },
  { id: '1.9.2', lineCode: 'L9S', name: 'Zona Universitària - Aeroport T1', color: '#FB712B', textColor: '#FFFFFF' },
  { id: '1.10.1', lineCode: 'L10N', name: 'La Sagrera - Gorg', color: '#00A6D6', textColor: '#FFFFFF' },
  { id: '1.10.2', lineCode: 'L10S', name: 'Zona Universitària - Collblanc', color: '#00A6D6', textColor: '#FFFFFF' },
  { id: '1.11.1', lineCode: 'L11', name: 'Trinitat Nova - Can Cuiàs', color: '#89B94C', textColor: '#FFFFFF' },
  { id: '1.7.1', lineCode: 'FM', name: 'Funicular de Montjuïc', color: '#004C38', textColor: '#FFFFFF' },
];

/**
 * Get Metro line by code (e.g., 'L1', 'L9N')
 */
export function getMetroLineByCode(lineCode: string): MetroLine | undefined {
  return METRO_LINES.find(line => line.lineCode === lineCode);
}

/**
 * Get color for a Metro line code
 */
export function getMetroLineColor(lineCode: string): string {
  const line = getMetroLineByCode(lineCode);
  return line?.color ?? '#888888';
}
