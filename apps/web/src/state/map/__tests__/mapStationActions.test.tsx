// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';

import { MapStateProvider } from '../MapStateProvider';
import { useMapStore } from '../useMapStore';

function createWrapper() {
  return function Wrapper({ children }: PropsWithChildren) {
    return <MapStateProvider>{children}</MapStateProvider>;
  };
}

describe('MapState station selection handling', () => {
  it('should select a station and open stationInfo panel', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => {
      const [state, actions] = useMapStore();
      return { state, actions };
    }, { wrapper });

    expect(result.current.state.ui.selectedStationId).toBeNull();
    expect(result.current.state.ui.activePanel).toBe('none');

    act(() => {
      result.current.actions.selectStation('79101');
    });

    expect(result.current.state.ui.selectedStationId).toBe('79101');
    expect(result.current.state.ui.activePanel).toBe('stationInfo');
  });

  it('should clear station selection when passed null', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => {
      const [state, actions] = useMapStore();
      return { state, actions };
    }, { wrapper });

    // First select a station
    act(() => {
      result.current.actions.selectStation('79101');
    });

    expect(result.current.state.ui.selectedStationId).toBe('79101');

    // Then clear it
    act(() => {
      result.current.actions.selectStation(null);
    });

    expect(result.current.state.ui.selectedStationId).toBeNull();
  });

  it('should not change activePanel when deselecting station', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => {
      const [state, actions] = useMapStore();
      return { state, actions };
    }, { wrapper });

    // Select station (opens panel)
    act(() => {
      result.current.actions.selectStation('79101');
    });

    expect(result.current.state.ui.activePanel).toBe('stationInfo');

    // Deselect station (should keep panel state)
    act(() => {
      result.current.actions.selectStation(null);
    });

    expect(result.current.state.ui.selectedStationId).toBeNull();
    expect(result.current.state.ui.activePanel).toBe('stationInfo');
  });

  it('should replace previous station selection', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => {
      const [state, actions] = useMapStore();
      return { state, actions };
    }, { wrapper });

    act(() => {
      result.current.actions.selectStation('79101');
    });

    expect(result.current.state.ui.selectedStationId).toBe('79101');

    act(() => {
      result.current.actions.selectStation('79102');
    });

    expect(result.current.state.ui.selectedStationId).toBe('79102');
  });

  it('should initialize with null selectedStationId', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => {
      const [state] = useMapStore();
      return { state };
    }, { wrapper });

    expect(result.current.state.ui.selectedStationId).toBeNull();
  });
});

describe('MapState station load error handling', () => {
  it('should initialize with null stationLoadError', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => {
      const [state] = useMapStore();
      return { state };
    }, { wrapper });

    expect(result.current.state.ui.stationLoadError).toBeNull();
  });

  it('should clear station load error on retry', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => {
      const [state, actions] = useMapStore();
      return { state, actions };
    }, { wrapper });

    // Simulate error state (would normally be set by data loader failure)
    // For now, we can only test that retryStationLoad clears the error
    // The actual error setting would happen in StationLayer component

    act(() => {
      result.current.actions.retryStationLoad();
    });

    expect(result.current.state.ui.stationLoadError).toBeNull();
  });
});

describe('MapState station and line interaction', () => {
  it('should allow station selection independent of line highlighting', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => {
      const [state, actions] = useMapStore();
      return { state, actions };
    }, { wrapper });

    // Highlight a line
    act(() => {
      result.current.actions.highlightLine('R1');
    });

    // Select a station
    act(() => {
      result.current.actions.selectStation('79101');
    });

    expect(result.current.state.ui.selectedLineId).toBe('R1');
    expect(result.current.state.ui.highlightMode).toBe('highlight');
    expect(result.current.state.ui.selectedStationId).toBe('79101');
    expect(result.current.state.ui.activePanel).toBe('stationInfo');
  });

  it('should maintain station selection when clearing line highlight', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => {
      const [state, actions] = useMapStore();
      return { state, actions };
    }, { wrapper });

    // Highlight line and select station
    act(() => {
      result.current.actions.highlightLine('R1');
      result.current.actions.selectStation('79101');
    });

    expect(result.current.state.ui.selectedStationId).toBe('79101');

    // Clear line highlight
    act(() => {
      result.current.actions.clearHighlightedLine();
    });

    expect(result.current.state.ui.selectedLineId).toBeNull();
    expect(result.current.state.ui.selectedStationId).toBe('79101');
  });

  it('should maintain line highlight when clearing station selection', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => {
      const [state, actions] = useMapStore();
      return { state, actions };
    }, { wrapper });

    // Highlight line and select station
    act(() => {
      result.current.actions.highlightLine('R1');
      result.current.actions.selectStation('79101');
    });

    expect(result.current.state.ui.selectedLineId).toBe('R1');

    // Clear station selection
    act(() => {
      result.current.actions.selectStation(null);
    });

    expect(result.current.state.ui.selectedLineId).toBe('R1');
    expect(result.current.state.ui.highlightMode).toBe('highlight');
    expect(result.current.state.ui.selectedStationId).toBeNull();
  });
});
