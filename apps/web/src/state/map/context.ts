import { createContext } from 'react';

import type {
  MapActions,
  MapHighlightSelectors,
  MapState,
} from './types';
import type {
  MapCoreState,
  MapNetworkContextState,
  MapUIContextState,
} from './contextTypes';

/** @internal Used by useMapStore() for full reducer state access */
export const MapStateContext = createContext<MapState | null>(null);
export const MapActionsContext = createContext<MapActions | null>(null);
export const MapHighlightSelectorsContext =
  createContext<MapHighlightSelectors | null>(null);

export const MapCoreContext = createContext<MapCoreState | null>(null);
export const MapUIContext = createContext<MapUIContextState | null>(null);
export const MapNetworkContext = createContext<MapNetworkContextState | null>(null);
