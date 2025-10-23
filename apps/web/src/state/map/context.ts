import { createContext } from 'react';

import type {
  MapActions,
  MapHighlightSelectors,
  MapState,
} from './types';

export const MapStateContext = createContext<MapState | null>(null);
export const MapActionsContext = createContext<MapActions | null>(null);
export const MapHighlightSelectorsContext =
  createContext<MapHighlightSelectors | null>(null);
