/**
 * Tests for useStationHover Hook
 * Feature: 004-station-visualization
 *
 * Tests verify:
 * - Desktop-only behavior (no hover on touch devices)
 * - Tooltip timing (100ms appear, 200ms disappear, 500ms line count)
 * - Proper cleanup on unmount
 *
 * Tasks: T068-T070
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStationHover } from '../useStationHover';
import type { Map as MapboxMap } from 'mapbox-gl';

// Create mock popup instance
const mockPopupInstance = {
  setLngLat: vi.fn().mockReturnThis(),
  setHTML: vi.fn().mockReturnThis(),
  addTo: vi.fn().mockReturnThis(),
  remove: vi.fn(),
};

// Mock mapbox-gl
vi.mock('mapbox-gl', () => ({
  default: {
    Popup: vi.fn(() => mockPopupInstance),
  },
}));

describe('useStationHover', () => {
  let mockMap: Partial<MapboxMap>;
  let eventHandlers: Record<string, Record<string, (...args: unknown[]) => unknown>>;
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    // Store original matchMedia
    originalMatchMedia = window.matchMedia;

    // Mock matchMedia to simulate desktop (hover supported)
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(hover: none)' ? false : true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    // Track event handlers
    eventHandlers = {};

    // Create mock map
    mockMap = {
      on: vi.fn((event: string, layerId: string, handler: (...args: unknown[]) => unknown) => {
        if (!eventHandlers[layerId]) {
          eventHandlers[layerId] = {};
        }
        eventHandlers[layerId][event] = handler;
      }) as unknown as MapboxMap['on'],
      off: vi.fn(),
      getLayer: vi.fn(() => ({ id: 'test-layer', type: 'symbol' })) as unknown as MapboxMap['getLayer'],
    };

    // Reset mock popup instance
    mockPopupInstance.setLngLat.mockClear();
    mockPopupInstance.setHTML.mockClear();
    mockPopupInstance.addTo.mockClear();
    mockPopupInstance.remove.mockClear();
  });

  afterEach(() => {
    // Restore original matchMedia
    window.matchMedia = originalMatchMedia;
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  describe('T068: Basic hook functionality', () => {
    it('should not initialize popup on touch devices', () => {
      // Mock matchMedia to simulate touch device
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(hover: none)' ? true : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      renderHook(() =>
        useStationHover({
          map: mockMap as MapboxMap,
          layerIds: ['stations-lowmarkers'],
          onStationHover: undefined,
        })
      );

      // Should not register any event handlers on touch devices
      expect(mockMap.on).not.toHaveBeenCalled();
    });

    it('should initialize popup on desktop devices', () => {
      renderHook(() =>
        useStationHover({
          map: mockMap as MapboxMap,
          layerIds: ['stations-lowmarkers'],
          onStationHover: undefined,
        })
      );

      // Should register mouseenter and mouseleave handlers
      expect(mockMap.on).toHaveBeenCalledWith(
        'mouseenter',
        'stations-lowmarkers',
        expect.any(Function)
      );
      expect(mockMap.on).toHaveBeenCalledWith(
        'mouseleave',
        'stations-lowmarkers',
        expect.any(Function)
      );
    });

    it('should handle null map gracefully', () => {
      const { rerender } = renderHook(() =>
        useStationHover({
          map: null,
          layerIds: ['stations-lowmarkers'],
          onStationHover: undefined,
        })
      );

      // Should not throw errors
      expect(() => rerender()).not.toThrow();
    });

    it('should handle empty layer IDs', () => {
      renderHook(() =>
        useStationHover({
          map: mockMap as MapboxMap,
          layerIds: [],
          onStationHover: undefined,
        })
      );

      // Should not register any handlers for empty array
      expect(mockMap.on).not.toHaveBeenCalled();
    });

    it('should register handlers for multiple layers', () => {
      const layerIds = ['layer-1', 'layer-2', 'layer-3'];

      renderHook(() =>
        useStationHover({
          map: mockMap as MapboxMap,
          layerIds,
          onStationHover: undefined,
        })
      );

      // Should register handlers for all layers
      layerIds.forEach((layerId) => {
        expect(mockMap.on).toHaveBeenCalledWith('mouseenter', layerId, expect.any(Function));
        expect(mockMap.on).toHaveBeenCalledWith('mouseleave', layerId, expect.any(Function));
      });
    });
  });

  describe('T069: Tooltip timing', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should show tooltip within 100ms of mouseenter', () => {
      const onStationHover = vi.fn();

      renderHook(() =>
        useStationHover({
          map: mockMap as MapboxMap,
          layerIds: ['stations-lowmarkers'],
          onStationHover,
        })
      );

      // Simulate mouseenter event
      const mouseenterHandler = eventHandlers['stations-lowmarkers']?.mouseenter;
      expect(mouseenterHandler).toBeDefined();

      const mockEvent = {
        features: [
          {
            properties: {
              id: 'station-1',
              name: 'Test Station',
              lines: JSON.stringify(['R1', 'R2']),
            },
            geometry: {
              coordinates: [2.123, 41.456],
            },
          },
        ],
      };

      mouseenterHandler(mockEvent);

      // Advance timers by 100ms (debounce delay)
      vi.advanceTimersByTime(100);

      // Tooltip should be shown
      expect(onStationHover).toHaveBeenCalledWith('station-1');
    });

    it('should show line count after 500ms continuous hover', () => {
      renderHook(() =>
        useStationHover({
          map: mockMap as MapboxMap,
          layerIds: ['stations-lowmarkers'],
          onStationHover: undefined,
        })
      );

      // Simulate mouseenter event
      const mouseenterHandler = eventHandlers['stations-lowmarkers']?.mouseenter;
      const mockEvent = {
        features: [
          {
            properties: {
              id: 'station-1',
              name: 'Test Station',
              lines: JSON.stringify(['R1', 'R2']),
            },
            geometry: {
              coordinates: [2.123, 41.456],
            },
          },
        ],
      };

      mouseenterHandler(mockEvent);

      // Advance by 100ms (initial tooltip)
      vi.advanceTimersByTime(100);

      // Initial tooltip should be set (station name only)
      expect(mockPopupInstance.setHTML).toHaveBeenCalledWith(expect.stringContaining('Test Station'));

      // Reset mock to track next call
      mockPopupInstance.setHTML.mockClear();

      // Advance by 500ms more (total 600ms) for line count
      vi.advanceTimersByTime(500);

      // Extended tooltip should now include line count
      expect(mockPopupInstance.setHTML).toHaveBeenCalledWith(
        expect.stringMatching(/Test Station.*2\s+lines/s)
      );
    });

    it('should remove tooltip within 200ms of mouseleave', () => {
      const onStationHover = vi.fn();

      renderHook(() =>
        useStationHover({
          map: mockMap as MapboxMap,
          layerIds: ['stations-lowmarkers'],
          onStationHover,
        })
      );

      // Simulate mouseenter
      const mouseenterHandler = eventHandlers['stations-lowmarkers']?.mouseenter;
      const mockEvent = {
        features: [
          {
            properties: {
              id: 'station-1',
              name: 'Test Station',
              lines: JSON.stringify(['R1']),
            },
            geometry: {
              coordinates: [2.123, 41.456],
            },
          },
        ],
      };

      mouseenterHandler(mockEvent);
      vi.advanceTimersByTime(100);

      // Simulate mouseleave
      const mouseleaveHandler = eventHandlers['stations-lowmarkers']?.mouseleave;
      expect(mouseleaveHandler).toBeDefined();
      mouseleaveHandler();

      // Advance by 200ms
      vi.advanceTimersByTime(200);

      // Tooltip should be removed
      expect(mockPopupInstance.remove).toHaveBeenCalled();
      expect(onStationHover).toHaveBeenCalledWith(null);
    });

    it('should cancel line count timer if mouse leaves before 500ms', () => {
      renderHook(() =>
        useStationHover({
          map: mockMap as MapboxMap,
          layerIds: ['stations-lowmarkers'],
          onStationHover: undefined,
        })
      );

      // Simulate mouseenter
      const mouseenterHandler = eventHandlers['stations-lowmarkers']?.mouseenter;
      const mockEvent = {
        features: [
          {
            properties: {
              id: 'station-1',
              name: 'Test Station',
              lines: JSON.stringify(['R1', 'R2']),
            },
            geometry: {
              coordinates: [2.123, 41.456],
            },
          },
        ],
      };

      mouseenterHandler(mockEvent);
      vi.advanceTimersByTime(100);

      // Initial tooltip set
      expect(mockPopupInstance.setHTML).toHaveBeenCalledTimes(1);
      mockPopupInstance.setHTML.mockClear();

      // Leave after 300ms (before 500ms line count timer)
      vi.advanceTimersByTime(200);
      const mouseleaveHandler = eventHandlers['stations-lowmarkers']?.mouseleave;
      mouseleaveHandler();

      // Advance past where line count would have appeared
      vi.advanceTimersByTime(300);

      // setHTML should not be called again for line count
      expect(mockPopupInstance.setHTML).not.toHaveBeenCalled();
    });
  });

  describe('T070: Desktop-only behavior', () => {
    it('should not register handlers on touch devices', () => {
      // Mock matchMedia to simulate touch device (hover not supported)
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(hover: none)' ? true : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      renderHook(() =>
        useStationHover({
          map: mockMap as MapboxMap,
          layerIds: ['stations-lowmarkers'],
          onStationHover: vi.fn(),
        })
      );

      // Event handlers should not be registered
      expect(mockMap.on).not.toHaveBeenCalled();
    });

    it('should register handlers on desktop devices (hover supported)', () => {
      // Mock matchMedia to simulate desktop device
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(hover: none)' ? false : true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      renderHook(() =>
        useStationHover({
          map: mockMap as MapboxMap,
          layerIds: ['stations-lowmarkers'],
          onStationHover: vi.fn(),
        })
      );

      // Event handlers should be registered
      expect(mockMap.on).toHaveBeenCalled();
    });

    it('should use media query "(hover: none)" to detect touch devices', () => {
      const matchMediaSpy = vi.spyOn(window, 'matchMedia');

      renderHook(() =>
        useStationHover({
          map: mockMap as MapboxMap,
          layerIds: ['stations-lowmarkers'],
          onStationHover: undefined,
        })
      );

      // Should check for hover capability
      expect(matchMediaSpy).toHaveBeenCalledWith('(hover: none)');
    });
  });

  describe('Cleanup', () => {
    it('should remove event handlers on unmount', () => {
      const { unmount } = renderHook(() =>
        useStationHover({
          map: mockMap as MapboxMap,
          layerIds: ['stations-lowmarkers'],
          onStationHover: undefined,
        })
      );

      unmount();

      // Should remove event handlers
      expect(mockMap.off).toHaveBeenCalledWith(
        'mouseenter',
        'stations-lowmarkers',
        expect.any(Function)
      );
      expect(mockMap.off).toHaveBeenCalledWith(
        'mouseleave',
        'stations-lowmarkers',
        expect.any(Function)
      );
    });

    it('should clear timers on unmount', () => {
      vi.useFakeTimers();

      const { unmount } = renderHook(() =>
        useStationHover({
          map: mockMap as MapboxMap,
          layerIds: ['stations-lowmarkers'],
          onStationHover: undefined,
        })
      );

      // Trigger mouseenter to start timers
      const mouseenterHandler = eventHandlers['stations-lowmarkers']?.mouseenter;
      const mockEvent = {
        features: [
          {
            properties: {
              id: 'station-1',
              name: 'Test Station',
              lines: JSON.stringify(['R1']),
            },
            geometry: {
              coordinates: [2.123, 41.456],
            },
          },
        ],
      };

      mouseenterHandler(mockEvent);

      // Unmount before timers fire
      unmount();

      // Advance timers - handlers should not be called after unmount
      vi.advanceTimersByTime(1000);

      vi.useRealTimers();
    });

    it('should remove popup on unmount', () => {
      const { unmount } = renderHook(() =>
        useStationHover({
          map: mockMap as MapboxMap,
          layerIds: ['stations-lowmarkers'],
          onStationHover: undefined,
        })
      );

      unmount();

      // Popup should be removed
      expect(mockPopupInstance.remove).toHaveBeenCalled();
    });
  });
});
