/**
 * Control Panel Types
 *
 * Type definitions for the unified control panel UI.
 */

import type { TransportType, MapHighlightMode } from '@/types/rodalies';

import metroLogo from '@/assets/network-logos/Metro.png';
import busLogo from '@/assets/network-logos/Bus.png';
import rodaliesLogo from '@/assets/network-logos/Rodalies.png';
import fgcLogo from '@/assets/network-logos/FGC.png';
import tramLogo from '@/assets/network-logos/TRAM.png';

/**
 * Network tab configuration for the control panel
 */
export interface NetworkTabConfig {
  type: TransportType;
  icon: string;
  label: string;
}

/**
 * Tab configurations for all networks (ordered by ridership)
 */
export const NETWORK_TABS: NetworkTabConfig[] = [
  { type: 'metro', icon: metroLogo, label: 'Metro' },
  { type: 'bus', icon: busLogo, label: 'Bus' },
  { type: 'rodalies', icon: rodaliesLogo, label: 'Rodalies' },
  { type: 'fgc', icon: fgcLogo, label: 'FGC' },
  { type: 'tram', icon: tramLogo, label: 'TRAM' },
];

/**
 * Per-network highlight state
 */
export interface NetworkHighlightState {
  highlightMode: MapHighlightMode;
  selectedLineIds: string[];
}

/**
 * Highlight state for all networks
 */
export type NetworkHighlightMap = Record<TransportType, NetworkHighlightState>;

/**
 * Per-network 3D model scale (0.5 to 2.0)
 */
export type ModelSizeMap = Record<TransportType, number>;

/**
 * Default model sizes for each network (1.0 = 100%)
 */
export const DEFAULT_MODEL_SIZES: ModelSizeMap = {
  rodalies: 1.0,
  metro: 1.0,
  fgc: 1.0,
  tram: 1.0,
  bus: 1.0,
};

/**
 * Default highlight state for all networks
 */
export const DEFAULT_NETWORK_HIGHLIGHTS: NetworkHighlightMap = {
  rodalies: { highlightMode: 'none', selectedLineIds: [] },
  metro: { highlightMode: 'none', selectedLineIds: [] },
  fgc: { highlightMode: 'none', selectedLineIds: [] },
  tram: { highlightMode: 'none', selectedLineIds: [] },
  bus: { highlightMode: 'none', selectedLineIds: [] },
};

/**
 * Control panel mode - switches between controls and vehicle list
 */
export type ControlPanelMode = 'controls' | 'vehicles';

/**
 * Line info for display in the control panel
 */
export interface LineInfo {
  id: string;
  code: string;
  name: string;
  color: string;
}

/**
 * Bus route group prefixes for categorization
 */
export const BUS_ROUTE_GROUPS = {
  H: 'Horizontal',
  V: 'Vertical',
  D: 'Diagonal',
  N: 'Night',
  A: 'Airport',
} as const;

export type BusRoutePrefix = keyof typeof BUS_ROUTE_GROUPS;
