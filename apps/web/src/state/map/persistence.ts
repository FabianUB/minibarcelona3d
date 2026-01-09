/**
 * persistence.ts - localStorage utilities for map preferences
 *
 * Handles saving and loading user preferences (high contrast mode, legend state, etc.)
 * to localStorage with graceful error handling.
 *
 * Design decisions:
 * - Single key 'rodalies-map-preferences' for all preferences
 * - Merge strategy: preserve existing preferences when saving new ones
 * - Graceful fallbacks: corrupt data returns defaults, quota errors are logged but don't throw
 * - Type-safe: validates loaded data structure
 */

import type { ModelSizeMap, NetworkHighlightMap, TransportFilterState, TransportType } from '../../types/rodalies';

const STORAGE_KEY = 'rodalies-map-preferences';

/**
 * Map preferences structure stored in localStorage
 */
export interface MapPreferences {
  isHighContrast?: boolean;
  isLegendOpen?: boolean;
  transportFilters?: TransportFilterState;
  modelSizes?: ModelSizeMap;
  networkHighlights?: NetworkHighlightMap;
  activeControlTab?: TransportType;
  showStations?: boolean;
  showOnlyTopBusLines?: boolean;
  // Future preferences can be added here
  [key: string]: unknown;
}

/**
 * Load preferences from localStorage
 *
 * @returns Preferences object or empty object if not found/invalid
 */
export function loadPreferences(): MapPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored);

    // Validate it's an object (not array, null, etc.)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.warn('[persistence] Invalid preferences format, using defaults');
      return {};
    }

    return parsed as MapPreferences;
  } catch (error) {
    // Handle JSON parse errors or localStorage access errors
    console.error('[persistence] Failed to load preferences:', error);
    return {};
  }
}

/**
 * Save preferences to localStorage
 *
 * Merges with existing preferences to preserve other settings.
 *
 * @param updates - Partial preferences to save
 */
export function savePreferences(updates: Partial<MapPreferences>): void {
  try {
    // Load existing preferences to preserve other settings
    const existing = loadPreferences();

    // Merge updates with existing
    const merged = {
      ...existing,
      ...updates,
    };

    // Save to localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch (error) {
    // Handle quota exceeded or other storage errors
    // Don't throw - this is a non-critical enhancement
    console.error('[persistence] Failed to save preferences:', error);
  }
}

/**
 * Get a specific preference value with type-safe default
 *
 * @param key - Preference key
 * @param defaultValue - Default value if not found or wrong type
 * @returns Preference value or default
 */
export function getPreference<T>(key: keyof MapPreferences, defaultValue: T): T {
  const preferences = loadPreferences();
  const value = preferences[key];

  // Type check: ensure value matches default type
  if (typeof value === typeof defaultValue) {
    return value as T;
  }

  return defaultValue;
}

/**
 * Clear all preferences from localStorage
 */
export function clearPreferences(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('[persistence] Failed to clear preferences:', error);
  }
}
