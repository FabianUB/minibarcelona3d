import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMapActions, useMapState } from '../../../state/map';
import type { PropsWithChildren } from 'react';
import { MapStateProvider } from '../../../state/map/MapStateProvider';

/**
 * Contrast Toggle State Persistence Tests
 *
 * Tests that high contrast mode preference persists across sessions using localStorage.
 *
 * IMPLEMENTATION STATUS:
 * - T027: ContrastToggle component (completed)
 * - T029: localStorage persistence logic (completed)
 */

// Mock localStorage with proper methods
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Wrapper component for hooks that need MapStateProvider
function Wrapper({ children }: PropsWithChildren) {
  return <MapStateProvider>{children}</MapStateProvider>;
}

describe('Contrast Toggle State Persistence', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    // Mock console methods to avoid noise
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should initialize with high contrast disabled by default', () => {
    const { result } = renderHook(() => useMapState(), { wrapper: Wrapper });

    expect(result.current.ui.isHighContrast).toBe(false);
  });

  it('should toggle high contrast mode', () => {
    const { result } = renderHook(() => ({
      state: useMapState(),
      actions: useMapActions(),
    }), {
      wrapper: Wrapper,
    });

    // Initially disabled
    expect(result.current.state.ui.isHighContrast).toBe(false);

    // Enable high contrast
    act(() => {
      result.current.actions.setHighContrast(true);
    });

    expect(result.current.state.ui.isHighContrast).toBe(true);

    // Disable high contrast
    act(() => {
      result.current.actions.setHighContrast(false);
    });

    expect(result.current.state.ui.isHighContrast).toBe(false);
  });

  it('should toggle high contrast with toggleHighContrast action', () => {
    const { result } = renderHook(() => ({
      state: useMapState(),
      actions: useMapActions(),
    }), {
      wrapper: Wrapper,
    });

    // Initially disabled
    expect(result.current.state.ui.isHighContrast).toBe(false);

    // Toggle to enable
    act(() => {
      result.current.actions.toggleHighContrast();
    });

    expect(result.current.state.ui.isHighContrast).toBe(true);

    // Toggle to disable
    act(() => {
      result.current.actions.toggleHighContrast();
    });

    expect(result.current.state.ui.isHighContrast).toBe(false);
  });

  it('should persist high contrast state to localStorage', () => {
    const { result } = renderHook(() => useMapActions(), {
      wrapper: Wrapper,
    });

    // Enable high contrast
    act(() => {
      result.current.setHighContrast(true);
    });

    // Check localStorage
    const stored = localStorage.getItem('rodalies-map-preferences');
    expect(stored).toBeTruthy();

    if (stored) {
      const preferences = JSON.parse(stored);
      expect(preferences.isHighContrast).toBe(true);
    }
  });

  it('should restore high contrast state from localStorage on mount', () => {
    // Set localStorage before mounting
    localStorage.setItem(
      'rodalies-map-preferences',
      JSON.stringify({ isHighContrast: true }),
    );

    const { result } = renderHook(() => useMapState(), { wrapper: Wrapper });

    // Should restore from localStorage
    expect(result.current.ui.isHighContrast).toBe(true);
  });

  it('should handle corrupt localStorage data gracefully', () => {
    // Set invalid JSON in localStorage
    localStorage.setItem('rodalies-map-preferences', 'invalid-json{');

    const { result } = renderHook(() => useMapState(), { wrapper: Wrapper });

    // Should fallback to default (disabled)
    expect(result.current.ui.isHighContrast).toBe(false);
  });

  it('should handle missing isHighContrast key in stored preferences', () => {
    // Set preferences without isHighContrast key
    localStorage.setItem(
      'rodalies-map-preferences',
      JSON.stringify({ someOtherKey: 'value' }),
    );

    const { result } = renderHook(() => useMapState(), { wrapper: Wrapper });

    // Should fallback to default (disabled)
    expect(result.current.ui.isHighContrast).toBe(false);
  });

  it('should preserve other preferences when toggling contrast', () => {
    // Set initial preferences with other data
    localStorage.setItem(
      'rodalies-map-preferences',
      JSON.stringify({
        isHighContrast: false,
        isLegendOpen: true,
        customSetting: 'test-value',
      }),
    );

    const { result } = renderHook(() => useMapActions(), {
      wrapper: Wrapper,
    });

    // Enable high contrast
    act(() => {
      result.current.setHighContrast(true);
    });

    const stored = localStorage.getItem('rodalies-map-preferences');
    expect(stored).toBeTruthy();

    if (stored) {
      const preferences = JSON.parse(stored);
      expect(preferences.isHighContrast).toBe(true);
      // Other preferences should be preserved
      expect(preferences.customSetting).toBe('test-value');
    }
  });

  it('should update localStorage immediately on toggle', () => {
    const { result } = renderHook(() => useMapActions(), {
      wrapper: Wrapper,
    });

    // Toggle multiple times
    act(() => {
      result.current.setHighContrast(true);
    });

    let stored = localStorage.getItem('rodalies-map-preferences');
    expect(stored).toBeTruthy();
    if (stored) {
      expect(JSON.parse(stored).isHighContrast).toBe(true);
    }

    act(() => {
      result.current.setHighContrast(false);
    });

    stored = localStorage.getItem('rodalies-map-preferences');
    expect(stored).toBeTruthy();
    if (stored) {
      expect(JSON.parse(stored).isHighContrast).toBe(false);
    }
  });

  it('should handle localStorage quota exceeded gracefully', () => {
    const { result } = renderHook(() => useMapActions(), {
      wrapper: Wrapper,
    });

    // Mock localStorage.setItem to throw quota exceeded error
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error('QuotaExceededError');
    });

    // Should not throw error
    expect(() => {
      act(() => {
        result.current.setHighContrast(true);
      });
    }).not.toThrow();

    // Restore original setItem
    Storage.prototype.setItem = originalSetItem;
  });
});
