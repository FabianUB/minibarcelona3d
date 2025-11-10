/**
 * Coordinate system helpers for Three.js integration with Mapbox GL JS
 *
 * Based on Mini Tokyo 3D patterns (see /docs/MINI-TOKYO-3D.md)
 *
 * Key concept: Instead of working in Mapbox's [0,1] coordinate space directly,
 * we establish a "model origin" and calculate all positions relative to it.
 * This improves precision and simplifies transforms.
 *
 * Related tasks: T052a, T052b, T052c, T052d
 */

import mapboxgl from 'mapbox-gl';

/**
 * The model origin - a reference point for all 3D object positions
 * Set to the map center to create a local coordinate system
 */
let modelOrigin: mapboxgl.MercatorCoordinate;

/**
 * Initialize the model origin at the map center
 *
 * MUST be called after map initialization, before any 3D objects are positioned
 *
 * @param center - Map center (supports any Mapbox LngLatLike)
 *
 * @example
 * const map = new mapboxgl.Map({...});
 * map.on('load', () => {
 *   setModelOrigin(map.getCenter());
 * });
 */
export function setModelOrigin(center: mapboxgl.LngLatLike): void {
  const lngLat = mapboxgl.LngLat.convert(center);
  modelOrigin = mapboxgl.MercatorCoordinate.fromLngLat(lngLat);
  console.log('Model origin set:', {
    lng: lngLat.lng,
    lat: lngLat.lat,
    mercator: { x: modelOrigin.x, y: modelOrigin.y, z: modelOrigin.z },
  });
}

/**
 * Convert GPS coordinates to Three.js position relative to model origin
 *
 * This is the CORRECT way to position 3D objects on a Mapbox map.
 * Don't calculate Mercator coordinates manually - use Mapbox's API.
 *
 * @param lng - Longitude in degrees
 * @param lat - Latitude in degrees
 * @param altitude - Altitude in meters (optional, default 0)
 * @returns Position {x, y, z} relative to model origin
 *
 * @throws Error if model origin not initialized
 *
 * @example
 * const position = getModelPosition(2.1734, 41.3851, 0);
 * trainMesh.position.set(position.x, position.y, position.z);
 */
export function getModelPosition(
  lng: number,
  lat: number,
  altitude: number = 0
): { x: number; y: number; z: number } {
  if (!modelOrigin) {
    throw new Error(
      'Model origin not initialized. Call setModelOrigin() first.'
    );
  }

  // Convert GPS to Mercator coordinates
  const coord = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], altitude);

  // Return position relative to model origin
  // CRITICAL: Y-axis is negated because Mapbox Y points south, Three.js Y points north
  return {
    x: coord.x - modelOrigin.x,
    y: -(coord.y - modelOrigin.y), // Negate Y!
    z: coord.z - modelOrigin.z,
  };
}

/**
 * Get the scale factor to convert meters to Mercator coordinate units
 *
 * Use this to scale 3D models in a realistic way:
 * - A 25-meter train: scale = getModelScale() * 25
 * - A 2-meter person: scale = getModelScale() * 2
 *
 * @returns Scale factor (meters to Mercator units)
 *
 * @throws Error if model origin not initialized
 *
 * @example
 * const modelScale = getModelScale();
 * const trainSizeMeters = 25; // 25 meter train
 * trainMesh.scale.setScalar(trainSizeMeters * modelScale);
 */
export function getModelScale(): number {
  if (!modelOrigin) {
    throw new Error(
      'Model origin not initialized. Call setModelOrigin() first.'
    );
  }

  // Returns how many Mercator units equal 1 meter at the model origin
  return modelOrigin.meterInMercatorCoordinateUnits();
}

export function getLngLatFromModelPosition(
  x: number,
  y: number,
  z: number = 0
): mapboxgl.LngLat {
  if (!modelOrigin) {
    throw new Error(
      'Model origin not initialized. Call setModelOrigin() first.'
    );
  }

  const coord = new mapboxgl.MercatorCoordinate(
    modelOrigin.x + x,
    modelOrigin.y - y,
    modelOrigin.z + z
  );

  return coord.toLngLat();
}

/**
 * Get the current model origin (for debugging)
 *
 * @returns The model origin MercatorCoordinate or undefined if not set
 */
export function getModelOrigin(): mapboxgl.MercatorCoordinate | undefined {
  return modelOrigin;
}
