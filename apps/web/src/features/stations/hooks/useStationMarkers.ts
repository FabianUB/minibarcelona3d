/**
 * useStationMarkers Hook
 * Feature: 004-station-visualization
 *
 * Manages station marker data loading and GeoJSON generation for Mapbox.
 * Handles radial offset calculation, station enrichment, and error states.
 *
 * Tasks: T023
 */

import { useState, useEffect, useCallback } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import type { Station } from '../../../types/rodalies';
import { loadStations, loadRodaliesLines } from '../../../lib/rodalies/dataLoader';
import { calculateRadialOffsets } from '../../../lib/stations/markerPositioning';

export interface UseStationMarkersReturn {
  /** GeoJSON FeatureCollection with station markers */
  geoJSON: {
    type: 'FeatureCollection';
    features: Array<{
      type: 'Feature';
      id: string;
      properties: {
        id: string;
        name: string;
        code: string | null;
        lines: string[];
        isMultiLine: boolean;
        dominantLineColor: string;
        lineCount: number;
        offsetX: number;
        offsetY: number;
      };
      geometry: {
        type: 'Point';
        coordinates: [number, number];
      };
    }>;
  } | null;

  /** Loading state */
  isLoading: boolean;

  /** Error message (null if no error) */
  error: string | null;

  /** Retry failed load */
  retry: () => void;
}

export interface UseStationMarkersParams {
  /** Mapbox GL map instance */
  map: MapboxMap | null;

  /** Highlighted line IDs (filters visible stations) */
  highlightedLineIds: string[];

  /** Highlight mode */
  highlightMode: 'none' | 'highlight' | 'isolate';
}

/**
 * Hook for managing station marker data
 *
 * Responsibilities:
 * - Load station and line data
 * - Calculate radial offsets for overlapping stations
 * - Enrich station features with display properties
 * - Handle loading and error states
 *
 * Acceptance Criteria:
 * - FR-001: Load all stations from Station.geojson
 * - FR-012: Apply radial offset positioning
 * - FR-004: Mark multi-line stations
 */
export function useStationMarkers({
  map,
}: UseStationMarkersParams): UseStationMarkersReturn {
  const [geoJSON, setGeoJSON] = useState<UseStationMarkersReturn['geoJSON']>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const loadData = useCallback(async () => {
    if (!map) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Load stations and lines in parallel
      const [stationFeatures, lines] = await Promise.all([
        loadStations(),
        loadRodaliesLines(),
      ]);

      // Convert features to Station objects
      const stations: Station[] = stationFeatures.features.map((feature) => ({
        id: feature.properties.id,
        name: feature.properties.name,
        code: feature.properties.code ?? null,
        lines: [...feature.properties.lines],
        geometry: feature.geometry,
      }));

      // Calculate radial offsets
      const offsets = calculateRadialOffsets(stations, map);
      const offsetMap = new Map(offsets.map((o) => [o.stationId, o]));

      // Create line color map
      const lineMap = new Map(lines.map((l) => [l.id, l]));

      // Generate GeoJSON with enriched properties
      const features = stations.map((station) => {
        const offset = offsetMap.get(station.id) || { offsetX: 0, offsetY: 0 };
        const firstLine = lineMap.get(station.lines[0]);
        const dominantLineColor = firstLine?.brand_color || '#CCCCCC';

        return {
          type: 'Feature' as const,
          id: station.id,
          properties: {
            id: station.id,
            name: station.name,
            code: station.code,
            lines: station.lines,
            isMultiLine: station.lines.length > 1,
            dominantLineColor,
            lineCount: station.lines.length,
            offsetX: offset.offsetX,
            offsetY: offset.offsetY,
          },
          geometry: station.geometry,
        };
      });

      setGeoJSON({
        type: 'FeatureCollection',
        features,
      });
      setIsLoading(false);
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load station data';
      setError(errorMessage);
      setIsLoading(false);
      console.error('Failed to load station markers:', err);
    }
  }, [map]);

  // Load data on mount and when dependencies change
  useEffect(() => {
    loadData();
  }, [loadData, retryCount]);

  // Note: No need to recalculate offsets on zoom changes.
  // Station markers use Mapbox GL expression-based sizing which handles zoom automatically.
  // Radial offsets are calculated once based on pixel positions at initial zoom level,
  // and Mapbox GL maintains the relative positioning as the map zooms.

  const retry = useCallback(() => {
    setRetryCount((prev) => prev + 1);
  }, []);

  return {
    geoJSON,
    isLoading,
    error,
    retry,
  };
}
