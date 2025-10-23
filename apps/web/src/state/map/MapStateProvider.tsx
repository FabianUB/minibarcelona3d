import { useMemo, useReducer } from 'react';
import type { PropsWithChildren } from 'react';

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
import type {
  MapHighlightMode,
  MapUIState,
  MapViewport,
} from '../../types/rodalies';

type MapAction =
  | { type: 'set-default-viewport'; payload: MapViewport }
  | { type: 'set-viewport'; payload: MapViewport }
  | { type: 'reset-viewport' }
  | {
      type: 'set-highlight';
      payload: { lineId: string | null; mode: MapHighlightMode };
    }
  | { type: 'toggle-line'; payload: string }
  | { type: 'highlight-line'; payload: string }
  | { type: 'isolate-line'; payload: string }
  | { type: 'clear-highlight' }
  | { type: 'set-high-contrast'; payload: boolean }
  | { type: 'toggle-high-contrast' }
  | { type: 'set-legend-open'; payload: boolean }
  | { type: 'set-map-instance'; payload: Map | null }
  | { type: 'set-map-loaded'; payload: boolean };

const initialUiState: MapUIState = {
  selectedLineId: null,
  selectedLineIds: [],
  highlightMode: 'none',
  isHighContrast: false,
  isLegendOpen: false,
};

const initialState: MapState = {
  defaultViewport: null,
  viewport: null,
  ui: initialUiState,
  mapInstance: null,
  isMapLoaded: false,
};

function mapReducer(state: MapState, action: MapAction): MapState {
  switch (action.type) {
    case 'set-default-viewport':
      return {
        ...state,
        defaultViewport: action.payload,
        viewport: action.payload,
      };
    case 'set-viewport':
      return {
        ...state,
        viewport: action.payload,
      };
    case 'reset-viewport':
      return state.defaultViewport
        ? { ...state, viewport: state.defaultViewport }
        : state;
    case 'set-highlight':
      return applyHighlightState(
        state,
        action.payload.lineId,
        action.payload.mode,
      );
    case 'toggle-line': {
      return toggleHighlightMode(state, action.payload, 'highlight');
    }
    case 'highlight-line':
      return toggleHighlightMode(state, action.payload, 'highlight');
    case 'isolate-line':
      return toggleHighlightMode(state, action.payload, 'isolate');
    case 'clear-highlight':
      return applyHighlightState(state, null, 'none');
    case 'set-high-contrast':
      return {
        ...state,
        ui: {
          ...state.ui,
          isHighContrast: action.payload,
        },
      };
    case 'toggle-high-contrast':
      return {
        ...state,
        ui: {
          ...state.ui,
          isHighContrast: !state.ui.isHighContrast,
        },
      };
    case 'set-legend-open':
      return {
        ...state,
        ui: {
          ...state.ui,
          isLegendOpen: action.payload,
        },
      };
    case 'set-map-instance':
      return {
        ...state,
        mapInstance: action.payload,
      };
    case 'set-map-loaded':
      return {
        ...state,
        isMapLoaded: action.payload,
      };
    default:
      return state;
  }
}

export function MapStateProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(mapReducer, initialState);

  const actions = useMemo<MapActions>(
    () => ({
      setDefaultViewport(viewport) {
        dispatch({ type: 'set-default-viewport', payload: viewport });
      },
      setViewport(viewport) {
        dispatch({ type: 'set-viewport', payload: viewport });
      },
      resetViewport() {
        dispatch({ type: 'reset-viewport' });
      },
      selectLine(lineId, mode = 'highlight') {
        if (!lineId) {
          dispatch({ type: 'clear-highlight' });
          return;
        }
        dispatch({
          type: 'set-highlight',
          payload: { lineId, mode },
        });
      },
      toggleLine(lineId) {
        dispatch({ type: 'toggle-line', payload: lineId });
      },
      highlightLine(lineId) {
        dispatch({ type: 'highlight-line', payload: lineId });
      },
      isolateLine(lineId) {
        dispatch({ type: 'isolate-line', payload: lineId });
      },
      clearHighlightedLine() {
        dispatch({ type: 'clear-highlight' });
      },
      setHighContrast(value) {
        dispatch({ type: 'set-high-contrast', payload: value });
      },
      toggleHighContrast() {
        dispatch({ type: 'toggle-high-contrast' });
      },
      setLegendOpen(value) {
        dispatch({ type: 'set-legend-open', payload: value });
      },
      setMapInstance(map) {
        dispatch({ type: 'set-map-instance', payload: map });
      },
      setMapLoaded(isLoaded) {
        dispatch({ type: 'set-map-loaded', payload: isLoaded });
      },
    }),
    [dispatch],
  );
  const highlightSelectors = useMemo<MapHighlightSelectors>(() => {
    const { highlightMode, selectedLineId, selectedLineIds } = state.ui;
    const activeLineIds = selectedLineIds.map(normaliseLineId).filter((id): id is string => id !== null);
    const isAnyLineHighlighted =
      highlightMode !== 'none' && activeLineIds.length > 0;
    const effectiveMode = isAnyLineHighlighted ? highlightMode : 'none';
    const activeLineId = activeLineIds.length > 0 ? activeLineIds[0] : null; // For backwards compatibility

    return {
      highlightMode: effectiveMode,
      highlightedLineId: activeLineId,
      highlightedLineIds: activeLineIds,
      isAnyLineHighlighted,
      isLineHighlighted(lineId: string) {
        const candidate = normaliseLineId(lineId);
        return Boolean(
          candidate && activeLineIds.includes(candidate),
        );
      },
      isLineDimmed(lineId: string) {
        if (effectiveMode !== 'isolate' || activeLineIds.length === 0) {
          return false;
        }
        const candidate = normaliseLineId(lineId);
        return Boolean(candidate && !activeLineIds.includes(candidate));
      },
    };
  }, [state.ui.highlightMode, state.ui.selectedLineId, state.ui.selectedLineIds]);

  // Note: Map viewport syncing is handled by MapCanvas component
  // to avoid circular updates between map events and state changes

  return (
    <MapStateContext.Provider value={state}>
      <MapActionsContext.Provider value={actions}>
        <MapHighlightSelectorsContext.Provider value={highlightSelectors}>
          {children}
        </MapHighlightSelectorsContext.Provider>
      </MapActionsContext.Provider>
    </MapStateContext.Provider>
  );
}

function applyHighlightState(
  state: MapState,
  rawLineId: string | null,
  mode: MapHighlightMode,
): MapState {
  const lineId = normaliseLineId(rawLineId);
  const safeMode: MapHighlightMode =
    mode === 'highlight' || mode === 'isolate' ? mode : 'none';
  const nextMode: MapHighlightMode = lineId ? safeMode : 'none';
  const nextLineId = nextMode === 'none' ? null : lineId;
  const nextLineIds = nextMode === 'none' ? [] : lineId ? [lineId] : [];

  if (
    state.ui.selectedLineId === nextLineId &&
    state.ui.highlightMode === nextMode
  ) {
    return state;
  }

  return {
    ...state,
    ui: {
      ...state.ui,
      selectedLineId: nextLineId,
      selectedLineIds: nextLineIds,
      highlightMode: nextMode,
    },
  };
}

function toggleHighlightMode(
  state: MapState,
  rawLineId: string,
  mode: MapHighlightMode,
): MapState {
  const lineId = normaliseLineId(rawLineId);
  if (!lineId) {
    return applyHighlightState(state, null, 'none');
  }

  // Check if this line is already selected in the current mode
  const isAlreadySelected = state.ui.selectedLineIds.includes(lineId) && state.ui.highlightMode === mode;

  if (isAlreadySelected) {
    // Remove this line from selection
    const nextLineIds = state.ui.selectedLineIds.filter(id => id !== lineId);
    if (nextLineIds.length === 0) {
      // No more selected lines, clear everything
      return {
        ...state,
        ui: {
          ...state.ui,
          selectedLineId: null,
          selectedLineIds: [],
          highlightMode: 'none',
        },
      };
    } else {
      // Still have other lines selected
      return {
        ...state,
        ui: {
          ...state.ui,
          selectedLineId: nextLineIds[0], // Keep first for backwards compatibility
          selectedLineIds: nextLineIds,
          highlightMode: mode,
        },
      };
    }
  } else {
    // Add this line to selection (or change mode if different)
    const nextLineIds = state.ui.highlightMode === mode
      ? [...state.ui.selectedLineIds, lineId]
      : [lineId]; // New mode, start fresh

    return {
      ...state,
      ui: {
        ...state.ui,
        selectedLineId: nextLineIds[0], // Keep first for backwards compatibility
        selectedLineIds: nextLineIds,
        highlightMode: mode,
      },
    };
  }
}

function normaliseLineId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
