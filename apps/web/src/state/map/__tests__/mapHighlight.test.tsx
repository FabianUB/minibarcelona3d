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

describe('MapState highlighted line handling', () => {
  it('highlights a line and clears highlight when invoked twice', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => {
      const [state, actions, selectors] = useMapStore();
      return { state, actions, selectors };
    }, { wrapper });

    act(() => {
      result.current.actions.highlightLine('R1');
    });

    expect(result.current.state.ui.selectedLineId).toBe('R1');
    expect(result.current.state.ui.highlightMode).toBe('highlight');
    expect(result.current.selectors.isAnyLineHighlighted).toBe(true);
    expect(result.current.selectors.isLineHighlighted('R1')).toBe(true);
    expect(result.current.selectors.isLineDimmed('R2')).toBe(false);

    act(() => {
      result.current.actions.highlightLine('R1');
    });

    expect(result.current.state.ui.selectedLineId).toBeNull();
    expect(result.current.state.ui.highlightMode).toBe('none');
    expect(result.current.selectors.isAnyLineHighlighted).toBe(false);
    expect(result.current.selectors.isLineHighlighted('R1')).toBe(false);
  });

  it('isolates a line and dims alternative entries until cleared', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => {
      const [state, actions, selectors] = useMapStore();
      return { state, actions, selectors };
    }, { wrapper });

    act(() => {
      result.current.actions.isolateLine('R2');
    });

    expect(result.current.state.ui.selectedLineId).toBe('R2');
    expect(result.current.state.ui.highlightMode).toBe('isolate');
    expect(result.current.selectors.isAnyLineHighlighted).toBe(true);
    expect(result.current.selectors.isLineHighlighted('R2')).toBe(true);
    expect(result.current.selectors.isLineDimmed('R1')).toBe(true);

    act(() => {
      result.current.actions.clearHighlightedLine();
    });

    expect(result.current.state.ui.selectedLineId).toBeNull();
    expect(result.current.state.ui.highlightMode).toBe('none');
    expect(result.current.selectors.isAnyLineHighlighted).toBe(false);
    expect(result.current.selectors.isLineDimmed('R1')).toBe(false);
  });
});

