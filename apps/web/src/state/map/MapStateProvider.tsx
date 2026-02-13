import { useMemo, useReducer, useEffect, useRef } from 'react';
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
  ControlPanelMode,
  MapHighlightMode,
  MapUIState,
  MapViewport,
  ModelSizeMap,
  NetworkHighlightMap,
  TransportFilterState,
  TransportType,
} from '../../types/rodalies';
import { getPreference, loadPreferences, savePreferences } from './persistence';
import { DEFAULT_NETWORK, createExclusiveFilters } from './transportDefaults';

const DEFAULT_TRANSPORT_FILTERS: TransportFilterState = createExclusiveFilters(DEFAULT_NETWORK);

const DEFAULT_NETWORK_HIGHLIGHTS: NetworkHighlightMap = {
  rodalies: { highlightMode: 'none', selectedLineIds: [] },
  metro: { highlightMode: 'none', selectedLineIds: [] },
  fgc: { highlightMode: 'none', selectedLineIds: [] },
  tram: { highlightMode: 'none', selectedLineIds: [] },
  bus: { highlightMode: 'none', selectedLineIds: [] },
};

const DEFAULT_MODEL_SIZES: ModelSizeMap = {
  rodalies: 1.0,
  metro: 1.6,
  fgc: 1.0,
  tram: 1.0,
  bus: 1.2,
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
  | { type: 'toggle-transport-filter'; payload: TransportType }
  // Control panel actions
  | { type: 'set-network-highlight'; payload: { network: TransportType; lineId: string; mode: MapHighlightMode } }
  | { type: 'toggle-network-line'; payload: { network: TransportType; lineId: string } }
  | { type: 'clear-network-highlight'; payload: TransportType }
  | { type: 'set-model-size'; payload: { network: TransportType; size: number } }
  | { type: 'set-exclusive-network'; payload: TransportType }
  | { type: 'toggle-network-multi'; payload: TransportType }
  | { type: 'set-active-control-tab'; payload: TransportType }
  | { type: 'set-control-panel-mode'; payload: ControlPanelMode }
  | { type: 'toggle-show-stations' }
  | { type: 'set-show-stations'; payload: boolean }
  | { type: 'toggle-show-only-top-bus-lines' }
  | { type: 'set-show-only-top-bus-lines'; payload: boolean }
  | { type: 'toggle-enable-train-parking' }
  | { type: 'set-enable-train-parking'; payload: boolean };

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

  // Load model sizes from preferences, merging with defaults
  const savedModelSizes = prefs.modelSizes;
  const modelSizes: ModelSizeMap = {
    ...DEFAULT_MODEL_SIZES,
    ...(savedModelSizes && typeof savedModelSizes === 'object' ? savedModelSizes : {}),
  };

  // Load active control tab from preferences (falls back to DEFAULT_NETWORK)
  const savedActiveTab = prefs.activeControlTab;
  const validTabs: TransportType[] = ['rodalies', 'metro', 'fgc', 'tram', 'bus'];
  const activeControlTab: TransportType =
    savedActiveTab && validTabs.includes(savedActiveTab) ? savedActiveTab : DEFAULT_NETWORK;

  // Load network highlights from preferences, merging with defaults
  const savedNetworkHighlights = prefs.networkHighlights;
  const networkHighlights: NetworkHighlightMap = {
    ...DEFAULT_NETWORK_HIGHLIGHTS,
  };
  // Carefully merge saved highlights to avoid invalid state
  if (savedNetworkHighlights && typeof savedNetworkHighlights === 'object') {
    for (const network of validTabs) {
      const saved = savedNetworkHighlights[network];
      if (saved && typeof saved === 'object') {
        const savedMode = saved.highlightMode;
        const savedLineIds = saved.selectedLineIds;
        networkHighlights[network] = {
          highlightMode: (savedMode === 'highlight' || savedMode === 'isolate') ? savedMode : 'none',
          selectedLineIds: Array.isArray(savedLineIds) ? savedLineIds.filter((id): id is string => typeof id === 'string') : [],
        };
      }
    }
  }

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
    showStations: getPreference('showStations', true), // Show stations by default
    showOnlyTopBusLines: getPreference('showOnlyTopBusLines', true), // Show only top 10 bus lines by default
    enableTrainParking: getPreference('enableTrainParking', true), // Rotate stopped trains perpendicular by default
    // Control panel state
    networkHighlights,
    modelSizes,
    activeControlTab,
    controlPanelMode: 'controls', // Default to controls mode
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
    // Control panel actions
    case 'set-network-highlight': {
      const { network, lineId, mode } = action.payload;
      return {
        ...state,
        ui: {
          ...state.ui,
          networkHighlights: {
            ...state.ui.networkHighlights,
            [network]: {
              highlightMode: mode,
              selectedLineIds: [lineId],
            },
          },
        },
      };
    }
    case 'toggle-network-line': {
      const { network, lineId } = action.payload;
      const currentState = state.ui.networkHighlights[network];
      const isSelected = currentState.selectedLineIds.includes(lineId);

      if (isSelected) {
        // Remove line from selection
        const nextLineIds = currentState.selectedLineIds.filter(id => id !== lineId);
        return {
          ...state,
          ui: {
            ...state.ui,
            networkHighlights: {
              ...state.ui.networkHighlights,
              [network]: {
                highlightMode: nextLineIds.length > 0 ? currentState.highlightMode : 'none',
                selectedLineIds: nextLineIds,
              },
            },
          },
        };
      } else {
        // Add line to selection
        return {
          ...state,
          ui: {
            ...state.ui,
            networkHighlights: {
              ...state.ui.networkHighlights,
              [network]: {
                highlightMode: currentState.highlightMode === 'none' ? 'highlight' : currentState.highlightMode,
                selectedLineIds: [...currentState.selectedLineIds, lineId],
              },
            },
          },
        };
      }
    }
    case 'clear-network-highlight': {
      const network = action.payload;
      return {
        ...state,
        ui: {
          ...state.ui,
          networkHighlights: {
            ...state.ui.networkHighlights,
            [network]: {
              highlightMode: 'none',
              selectedLineIds: [],
            },
          },
        },
      };
    }
    case 'set-model-size': {
      const { network, size } = action.payload;
      // Clamp size between 0.5 and 2.0
      const clampedSize = Math.max(0.5, Math.min(2.0, size));
      return {
        ...state,
        ui: {
          ...state.ui,
          modelSizes: {
            ...state.ui.modelSizes,
            [network]: clampedSize,
          },
        },
      };
    }
    case 'set-exclusive-network': {
      // Enable only this network, disable all others
      const network = action.payload;
      return {
        ...state,
        ui: {
          ...state.ui,
          transportFilters: createExclusiveFilters(network),
          activeControlTab: network,
        },
      };
    }
    case 'toggle-network-multi': {
      // Toggle this network without affecting others or changing active tab
      const network = action.payload;
      return {
        ...state,
        ui: {
          ...state.ui,
          transportFilters: {
            ...state.ui.transportFilters,
            [network]: !state.ui.transportFilters[network],
          },
          // Note: DO NOT change activeControlTab - multi-select should only toggle visibility
        },
      };
    }
    case 'set-active-control-tab':
      return {
        ...state,
        ui: {
          ...state.ui,
          activeControlTab: action.payload,
        },
      };
    case 'set-control-panel-mode':
      return {
        ...state,
        ui: {
          ...state.ui,
          controlPanelMode: action.payload,
        },
      };
    case 'toggle-show-stations':
      return {
        ...state,
        ui: {
          ...state.ui,
          showStations: !state.ui.showStations,
        },
      };
    case 'set-show-stations':
      return {
        ...state,
        ui: {
          ...state.ui,
          showStations: action.payload,
        },
      };
    case 'toggle-show-only-top-bus-lines':
      return {
        ...state,
        ui: {
          ...state.ui,
          showOnlyTopBusLines: !state.ui.showOnlyTopBusLines,
        },
      };
    case 'set-show-only-top-bus-lines':
      return {
        ...state,
        ui: {
          ...state.ui,
          showOnlyTopBusLines: action.payload,
        },
      };
    case 'toggle-enable-train-parking':
      return {
        ...state,
        ui: {
          ...state.ui,
          enableTrainParking: !state.ui.enableTrainParking,
        },
      };
    case 'set-enable-train-parking':
      return {
        ...state,
        ui: {
          ...state.ui,
          enableTrainParking: action.payload,
        },
      };
    default:
      return state;
  }
}

export function MapStateProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(mapReducer, undefined, createInitialState);

  // Persist UI preferences to localStorage when they change
  // Debounced to avoid blocking renders during rapid interactions (e.g., slider changes)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Clear any pending save to avoid stale writes
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    // Debounce by 500ms to batch rapid state changes
    saveTimeoutRef.current = setTimeout(() => {
      savePreferences({
        isHighContrast: state.ui.isHighContrast,
        isLegendOpen: state.ui.isLegendOpen,
        transportFilters: state.ui.transportFilters,
        modelSizes: state.ui.modelSizes,
        networkHighlights: state.ui.networkHighlights,
        activeControlTab: state.ui.activeControlTab,
        showStations: state.ui.showStations,
        showOnlyTopBusLines: state.ui.showOnlyTopBusLines,
        enableTrainParking: state.ui.enableTrainParking,
      });
    }, 500);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [state.ui.isHighContrast, state.ui.isLegendOpen, state.ui.transportFilters, state.ui.modelSizes, state.ui.networkHighlights, state.ui.activeControlTab, state.ui.showStations, state.ui.showOnlyTopBusLines, state.ui.enableTrainParking]);

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
      // Control panel actions
      setNetworkHighlight(network, lineId, mode) {
        dispatch({ type: 'set-network-highlight', payload: { network, lineId, mode } });
      },
      toggleNetworkLine(network, lineId) {
        dispatch({ type: 'toggle-network-line', payload: { network, lineId } });
      },
      clearNetworkHighlight(network) {
        dispatch({ type: 'clear-network-highlight', payload: network });
      },
      setModelSize(network, size) {
        dispatch({ type: 'set-model-size', payload: { network, size } });
      },
      setExclusiveNetwork(network) {
        dispatch({ type: 'set-exclusive-network', payload: network });
      },
      toggleNetworkMulti(network) {
        dispatch({ type: 'toggle-network-multi', payload: network });
      },
      setActiveControlTab(network) {
        dispatch({ type: 'set-active-control-tab', payload: network });
      },
      setControlPanelMode(mode) {
        dispatch({ type: 'set-control-panel-mode', payload: mode });
      },
      toggleShowStations() {
        dispatch({ type: 'toggle-show-stations' });
      },
      setShowStations(show) {
        dispatch({ type: 'set-show-stations', payload: show });
      },
      toggleShowOnlyTopBusLines() {
        dispatch({ type: 'toggle-show-only-top-bus-lines' });
      },
      setShowOnlyTopBusLines(show) {
        dispatch({ type: 'set-show-only-top-bus-lines', payload: show });
      },
      toggleEnableTrainParking() {
        dispatch({ type: 'toggle-enable-train-parking' });
      },
      setEnableTrainParking(enable) {
        dispatch({ type: 'set-enable-train-parking', payload: enable });
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
  }, [state.ui.highlightMode, state.ui.selectedLineIds]);

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
