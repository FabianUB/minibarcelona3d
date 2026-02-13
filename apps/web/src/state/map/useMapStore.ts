import { useContext } from 'react';

import {
  MapActionsContext,
  MapCoreContext,
  MapHighlightSelectorsContext,
  MapNetworkContext,
  MapStateContext,
  MapUIContext,
} from './context';
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

/** @deprecated Use useMapCore(), useMapUI(), or useMapNetwork() instead */
export function useMapState(): MapState {
  const ctx = useContext(MapStateContext);
  if (!ctx) {
    throw new Error('useMapState must be used within a MapStateProvider');
  }
  return ctx;
}

export function useMapCore(): MapCoreState {
  const ctx = useContext(MapCoreContext);
  if (!ctx) {
    throw new Error('useMapCore must be used within a MapStateProvider');
  }
  return ctx;
}

export function useMapUI(): MapUIContextState {
  const ctx = useContext(MapUIContext);
  if (!ctx) {
    throw new Error('useMapUI must be used within a MapStateProvider');
  }
  return ctx;
}

export function useMapNetwork(): MapNetworkContextState {
  const ctx = useContext(MapNetworkContext);
  if (!ctx) {
    throw new Error('useMapNetwork must be used within a MapStateProvider');
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

/** @internal Full reducer state + actions + selectors for testing */
export function useMapStore(): [
  MapState,
  MapActions,
  MapHighlightSelectors,
] {
  return [useMapState(), useMapActions(), useMapHighlightSelectors()];
}
