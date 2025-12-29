import { useMemo, useReducer, useEffect } from 'react';
import type { PropsWithChildren } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';

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
  TransportFilterState,
  TransportType,
} from '../../types/rodalies';
import { getPreference, loadPreferences, savePreferences } from './persistence';

const DEFAULT_TRANSPORT_FILTERS: TransportFilterState = {
  rodalies: true,
  metro: false,
  bus: false,
  tram: false,
  fgc: false,
};

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
  | { type: 'set-active-panel'; payload: import('../../types/rodalies').ActivePanel }
  | { type: 'set-map-instance'; payload: MapboxMap | null }
  | { type: 'set-map-loaded'; payload: boolean }
  | { type: 'select-station'; payload: string | null }
  | { type: 'set-station-load-error'; payload: string | null }
  | { type: 'set-transport-filter'; payload: { transportType: TransportType; visible: boolean } }
  | { type: 'toggle-transport-filter'; payload: TransportType };

/**
 * Create initial UI state with preferences loaded from localStorage
 */
function createInitialUiState(): MapUIState {
  // Load transport filters from preferences, merging with defaults
  const prefs = loadPreferences();
  const savedFilters = prefs.transportFilters;
  const transportFilters: TransportFilterState = {
    ...DEFAULT_TRANSPORT_FILTERS,
    ...(savedFilters && typeof savedFilters === 'object' ? savedFilters : {}),
  };

  return {
    selectedLineId: null,
    selectedLineIds: [],
    highlightMode: 'none',
    isHighContrast: getPreference('isHighContrast', false),
    isLegendOpen: getPreference('isLegendOpen', false),
    activePanel: 'none', // Don't persist - always start with no panel open
    selectedStationId: null,
    stationLoadError: null,
    transportFilters,
  };
}

function createInitialState(): MapState {
  return {
    defaultViewport: null,
    viewport: null,
    ui: createInitialUiState(),
    mapInstance: null,
    isMapLoaded: false,
  };
}

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
    case 'set-active-panel':
      return {
        ...state,
        ui: {
          ...state.ui,
          activePanel: action.payload,
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
    case 'select-station':
      return {
        ...state,
        ui: {
          ...state.ui,
          selectedStationId: action.payload,
          activePanel: action.payload ? 'stationInfo' : state.ui.activePanel,
        },
      };
    case 'set-station-load-error':
      return {
        ...state,
        ui: {
          ...state.ui,
          stationLoadError: action.payload,
        },
      };
    case 'set-transport-filter':
      return {
        ...state,
        ui: {
          ...state.ui,
          transportFilters: {
            ...state.ui.transportFilters,
            [action.payload.transportType]: action.payload.visible,
          },
        },
      };
    case 'toggle-transport-filter':
      return {
        ...state,
        ui: {
          ...state.ui,
          transportFilters: {
            ...state.ui.transportFilters,
            [action.payload]: !state.ui.transportFilters[action.payload],
          },
        },
      };
    default:
      return state;
  }
}

export function MapStateProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(mapReducer, undefined, createInitialState);

  // Persist high contrast preference to localStorage when it changes
  useEffect(() => {
    savePreferences({
      isHighContrast: state.ui.isHighContrast,
    });
  }, [state.ui.isHighContrast]);

  // Persist legend open state to localStorage when it changes
  useEffect(() => {
    savePreferences({
      isLegendOpen: state.ui.isLegendOpen,
    });
  }, [state.ui.isLegendOpen]);

  // Persist transport filter preferences to localStorage when they change
  useEffect(() => {
    savePreferences({
      transportFilters: state.ui.transportFilters,
    });
  }, [state.ui.transportFilters]);

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
      setActivePanel(panel: import('../../types/rodalies').ActivePanel) {
        dispatch({ type: 'set-active-panel', payload: panel });
      },
      setMapInstance(map) {
        dispatch({ type: 'set-map-instance', payload: map });
      },
      setMapLoaded(isLoaded) {
        dispatch({ type: 'set-map-loaded', payload: isLoaded });
      },
      selectStation(stationId) {
        dispatch({ type: 'select-station', payload: stationId });
      },
      retryStationLoad() {
        // Clear error state to trigger reload
        dispatch({ type: 'set-station-load-error', payload: null });
        // Note: Actual reload logic will be handled by components that depend on this state
      },
      setStationLoadError(message) {
        dispatch({ type: 'set-station-load-error', payload: message });
      },
      setTransportFilter(transportType, visible) {
        dispatch({ type: 'set-transport-filter', payload: { transportType, visible } });
      },
      toggleTransportFilter(transportType) {
        dispatch({ type: 'toggle-transport-filter', payload: transportType });
      },
    }),
    [dispatch],
  );
  const highlightSelectors = useMemo<MapHighlightSelectors>(() => {
    const { highlightMode, selectedLineIds } = state.ui;
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
  }, [state.ui]);

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
