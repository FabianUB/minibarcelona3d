/**
 * useMapStyleReady Hook
 *
 * Provides reliable detection of when a Mapbox GL map's style is fully loaded.
 *
 * Problem: When child components mount after MapCanvas sets isMapLoaded=true,
 * calling map.isStyleLoaded() may still return false due to timing between
 * React's render/commit phases and Mapbox GL's internal state updates.
 * Additionally, style.load and load events may have already fired before
 * the component's event listeners are attached.
 *
 * Solution: Poll every 50ms until isStyleLoaded() returns true, with event
 * listeners as backup for edge cases where the style loads after mounting.
 */

import { useEffect, useState } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';

const POLL_INTERVAL_MS = 50;

/**
 * Hook that returns true when the map's style is ready for layer operations.
 *
 * @param map - Mapbox GL map instance (can be null during initial render)
 * @returns boolean - true when map.isStyleLoaded() returns true
 *
 * @example
 * ```tsx
 * function MyLayer({ map }: { map: MapboxMap }) {
 *   const styleReady = useMapStyleReady(map);
 *
 *   useEffect(() => {
 *     if (!styleReady) return;
 *     // Safe to add layers here
 *     map.addLayer({ ... });
 *   }, [map, styleReady]);
 * }
 * ```
 */
export function useMapStyleReady(map: MapboxMap | null): boolean {
  const [styleReady, setStyleReady] = useState(false);

  useEffect(() => {
    if (!map) {
      setStyleReady(false);
      return;
    }

    // Check if already loaded
    if (map.isStyleLoaded()) {
      setStyleReady(true);
      return;
    }

    // Poll until ready (events may have already fired)
    const interval = setInterval(() => {
      if (map.isStyleLoaded()) {
        setStyleReady(true);
        clearInterval(interval);
      }
    }, POLL_INTERVAL_MS);

    // Also listen for events as backup
    const handleStyleReady = () => {
      if (map.isStyleLoaded()) {
        setStyleReady(true);
        clearInterval(interval);
      }
    };

    map.on('style.load', handleStyleReady);
    map.on('idle', handleStyleReady);

    return () => {
      clearInterval(interval);
      map.off('style.load', handleStyleReady);
      map.off('idle', handleStyleReady);
    };
  }, [map]);

  return styleReady;
}
