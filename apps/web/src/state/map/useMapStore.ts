import { useContext } from 'react';

import {
  MapActionsContext,
  MapHighlightSelectorsContext,
  MapStateContext,
} from './context';
import type {
  MapActions,
  MapHighlightSelectors,
  MapState,
} from './types';

export function useMapState(): MapState {
  const ctx = useContext(MapStateContext);
  if (!ctx) {
    throw new Error('useMapState must be used within a MapStateProvider');
  }
  return ctx;
}

export function useMapActions(): MapActions {
  const ctx = useContext(MapActionsContext);
  if (!ctx) {
    throw new Error('useMapActions must be used within a MapStateProvider');
  }
  return ctx;
}

export function useMapHighlightSelectors(): MapHighlightSelectors {
  const ctx = useContext(MapHighlightSelectorsContext);
  if (!ctx) {
    throw new Error(
      'useMapHighlightSelectors must be used within a MapStateProvider',
    );
  }
  return ctx;
}

export function useMapStore(): [
  MapState,
  MapActions,
  MapHighlightSelectors,
] {
  return [useMapState(), useMapActions(), useMapHighlightSelectors()];
}
