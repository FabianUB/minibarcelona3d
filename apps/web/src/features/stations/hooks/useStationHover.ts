/**
 * useStationHover Hook
 * Feature: 004-station-visualization
 *
 * Manages hover tooltip interactions for station markers.
 * Desktop-only feature that shows station name on hover,
 * with line count appearing after 500ms continuous hover.
 *
 * Tasks: T060-T067
 */

import { useEffect, useRef } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import mapboxgl from 'mapbox-gl';

export interface UseStationHoverOptions {
  /** Mapbox GL map instance */
  map: MapboxMap | null;

  /** Layer IDs to listen for hover events */
  layerIds: string[];

  /** Callback when user hovers over a station (optional, for external state) */
  onStationHover?: (stationId: string | null) => void;
}

/**
 * Hook to manage station hover tooltips
 *
 * Features:
 * - Desktop-only (uses media query to detect touch devices)
 * - Shows station name immediately on hover
 * - Shows line count after 500ms continuous hover
 * - Removes tooltip within 200ms of mouse leave
 * - Debounced hover with 100ms delay for performance
 *
 * Acceptance Criteria:
 * - FR-009: Show hover tooltips on desktop with station name
 * - SC-005: Tooltip appears within 100ms of cursor entering marker
 */
export function useStationHover({
  map,
  layerIds,
  onStationHover,
}: UseStationHoverOptions) {
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lineCountTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const removeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentStationRef = useRef<string | null>(null);

  useEffect(() => {
    if (!map || layerIds.length === 0) return;

    // Check if device supports hover (desktop only)
    // Touch devices don't support hover, so skip initialization
    const isTouchDevice = window.matchMedia('(hover: none)').matches;
    if (isTouchDevice) {
      return;
    }

    // Initialize popup instance (reused for all hover events)
    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      closeOnMove: false,
      className: 'station-hover-tooltip',
      offset: [0, -15], // Position above the marker
    });

    popupRef.current = popup;

    // Handle mouse enter on station markers
    const handleMouseEnter = (e: mapboxgl.MapMouseEvent) => {
      if (!map || !e.features || e.features.length === 0) return;

      const feature = e.features[0];
      const stationId = feature.properties?.id as string;
      const stationName = feature.properties?.name as string;
      const stationLines = feature.properties?.lines as string[] | string;

      // Parse lines if it's a JSON string
      let lineCount = 0;
      if (typeof stationLines === 'string') {
        try {
          const parsedLines = JSON.parse(stationLines);
          lineCount = Array.isArray(parsedLines) ? parsedLines.length : 0;
        } catch {
          lineCount = 0;
        }
      } else if (Array.isArray(stationLines)) {
        lineCount = stationLines.length;
      }

      if (!stationId || !stationName) return;

      currentStationRef.current = stationId;

      // Clear any existing timeouts
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      if (lineCountTimeoutRef.current) {
        clearTimeout(lineCountTimeoutRef.current);
      }

      // Debounce hover with 100ms delay (meets SC-005 requirement)
      hoverTimeoutRef.current = setTimeout(() => {
        if (!popup || !map) return;

        // Get coordinates from feature
        const geometry = feature.geometry as { type: 'Point'; coordinates: [number, number] };
        const coordinates = geometry.coordinates.slice();

        // Ensure coordinates are valid
        if (typeof coordinates[0] !== 'number' || typeof coordinates[1] !== 'number') {
          return;
        }

        // Initial tooltip content (station name only)
        const initialContent = `
          <div class="px-2 py-1 text-sm font-medium">
            ${stationName}
          </div>
        `;

        popup.setLngLat(coordinates as [number, number]).setHTML(initialContent).addTo(map);

        // Notify external listeners
        if (onStationHover) {
          onStationHover(stationId);
        }

        // After 500ms continuous hover, add line count
        lineCountTimeoutRef.current = setTimeout(() => {
          if (currentStationRef.current !== stationId || !popup) return;

          const extendedContent = `
            <div class="px-2 py-1 text-sm">
              <div class="font-medium">${stationName}</div>
              <div class="text-xs text-gray-600 mt-1">
                ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}
              </div>
            </div>
          `;

          popup.setHTML(extendedContent);
        }, 500);
      }, 100);
    };

    // Handle mouse leave from station markers
    const handleMouseLeave = () => {
      // Clear timeouts
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      if (lineCountTimeoutRef.current) {
        clearTimeout(lineCountTimeoutRef.current);
        lineCountTimeoutRef.current = null;
      }
      if (removeTimeoutRef.current) {
        clearTimeout(removeTimeoutRef.current);
      }

      // Remove popup with 200ms delay (meets requirement)
      // Track timeout to prevent memory leak if component unmounts
      removeTimeoutRef.current = setTimeout(() => {
        if (popupRef.current) {
          popupRef.current.remove();
        }
        currentStationRef.current = null;

        // Notify external listeners
        if (onStationHover) {
          onStationHover(null);
        }
      }, 200);
    };

    // Register event handlers for all provided layer IDs
    layerIds.forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.on('mouseenter', layerId, handleMouseEnter);
        map.on('mouseleave', layerId, handleMouseLeave);
      }
    });

    // Cleanup on unmount
    return () => {
      layerIds.forEach((layerId) => {
        if (map.getLayer(layerId)) {
          map.off('mouseenter', layerId, handleMouseEnter);
          map.off('mouseleave', layerId, handleMouseLeave);
        }
      });

      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      if (lineCountTimeoutRef.current) {
        clearTimeout(lineCountTimeoutRef.current);
      }
      if (removeTimeoutRef.current) {
        clearTimeout(removeTimeoutRef.current);
      }
      if (popupRef.current) {
        popupRef.current.remove();
      }
    };
  }, [map, layerIds, onStationHover]);
}
