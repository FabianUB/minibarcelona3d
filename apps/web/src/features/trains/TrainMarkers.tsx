/**
 * TrainMarkers Component
 *
 * Renders 2D train markers on the Mapbox map using real-time position data.
 * Implements Phase B (Proof of Concept) for User Story 1 (P1).
 *
 * Features:
 * - Fetches train positions on mount
 * - Polls for updates every 30 seconds
 * - Renders markers at GPS coordinates as orange circles
 * - Click handlers log vehicle key to console (prep for US2)
 * - Automatic cleanup on unmount
 *
 * Related tasks: T032, T033, T034, T035, T036, T037
 */

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { fetchTrainPositions } from '../../lib/api/trains';
import type { TrainPosition } from '../../types/trains';

export interface TrainMarkersProps {
  /**
   * Mapbox GL Map instance to render markers on
   * Must be initialized and loaded before passing to this component
   */
  map: mapboxgl.Map;
}

/**
 * Polling interval in milliseconds (30 seconds)
 * Matches acceptance criteria for US1
 */
const POLLING_INTERVAL_MS = 30000;

/**
 * TrainMarkers Component
 *
 * Displays real-time train positions as 2D markers on the map.
 * Automatically updates every 30 seconds by polling the backend API.
 */
export function TrainMarkers({ map }: TrainMarkersProps) {
  const [trains, setTrains] = useState<TrainPosition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Store marker references for cleanup and updates
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  // Store polling interval reference for cleanup
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Fetches latest train positions from the API
   * Updates state and handles errors
   */
  const fetchTrains = async () => {
    try {
      setIsLoading(true);
      const response = await fetchTrainPositions();

      // Filter out trains without valid GPS coordinates
      const validTrains = response.positions.filter(
        (train) => train.latitude !== null && train.longitude !== null
      );

      setTrains(validTrains);
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch train positions';
      setError(errorMessage);
      console.error('Error fetching train positions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // T033: Fetch trains on mount and set up polling interval
  useEffect(() => {
    // Initial fetch
    void fetchTrains();

    // Set up polling every 30 seconds
    pollingIntervalRef.current = setInterval(() => {
      void fetchTrains();
    }, POLLING_INTERVAL_MS);

    // Cleanup: clear interval on unmount
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []);

  // T034, T035: Create and update Mapbox markers when train data changes
  useEffect(() => {
    if (!map || trains.length === 0) {
      return;
    }

    const currentMarkers = markersRef.current;
    const newMarkerKeys = new Set<string>();

    // Create or update markers for each train
    trains.forEach((train) => {
      const { vehicleKey, latitude, longitude } = train;

      // Skip trains without valid coordinates
      if (latitude === null || longitude === null) {
        return;
      }

      newMarkerKeys.add(vehicleKey);

      const existingMarker = currentMarkers.get(vehicleKey);

      if (existingMarker) {
        // T035: Update existing marker position
        existingMarker.setLngLat([longitude, latitude]);
      } else {
        // T034: Create new marker with orange circle styling
        const markerElement = document.createElement('div');
        markerElement.className = 'train-marker';
        markerElement.style.width = '12px';
        markerElement.style.height = '12px';
        markerElement.style.borderRadius = '50%';
        markerElement.style.backgroundColor = '#FF8C00'; // Orange
        markerElement.style.border = '2px solid #FFFFFF';
        markerElement.style.cursor = 'pointer';
        markerElement.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';

        // T036: Add click event handler that logs vehicleKey
        markerElement.addEventListener('click', () => {
          console.log('Train clicked:', vehicleKey);
        });

        const marker = new mapboxgl.Marker({
          element: markerElement,
        })
          .setLngLat([longitude, latitude])
          .addTo(map);

        currentMarkers.set(vehicleKey, marker);
      }
    });

    // T037: Remove markers for trains that no longer exist
    currentMarkers.forEach((marker, vehicleKey) => {
      if (!newMarkerKeys.has(vehicleKey)) {
        marker.remove();
        currentMarkers.delete(vehicleKey);
      }
    });

    return () => {
      // T037: Cleanup all markers on unmount
      currentMarkers.forEach((marker) => {
        marker.remove();
      });
      currentMarkers.clear();
    };
  }, [map, trains]);

  // Log current state for debugging
  useEffect(() => {
    if (trains.length > 0) {
      console.log(`TrainMarkers: Displaying ${trains.length} trains on map`);
    }
  }, [trains]);

  // Optionally render error state
  if (error && !isLoading && trains.length === 0) {
    console.warn('TrainMarkers error:', error);
  }

  // This component doesn't render any JSX - it only manages map markers
  return null;
}
