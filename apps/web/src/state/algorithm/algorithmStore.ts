/**
 * Algorithm state store for position calculation preferences
 *
 * Uses Zustand for lightweight state management with localStorage persistence.
 * Allows users to switch between GPS-only and predictive positioning algorithms.
 *
 * Phase 1, Task T001
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PositionAlgorithmMode } from '../../types/algorithm';

/**
 * Algorithm state interface
 */
export interface AlgorithmState {
  /**
   * Current position algorithm mode
   * - 'gps-only': Use real-time GPS coordinates only (default)
   * - 'predictive': Use schedule-based interpolation with station parking
   */
  mode: PositionAlgorithmMode;

  /**
   * Set the algorithm mode
   * @param mode - New algorithm mode
   */
  setMode: (mode: PositionAlgorithmMode) => void;
}

/**
 * localStorage key for algorithm preference persistence
 */
const STORAGE_KEY = 'rodalies:positionAlgorithm';

/**
 * Algorithm state store with localStorage persistence
 *
 * Usage:
 * ```typescript
 * const { mode, setMode } = useAlgorithmState();
 *
 * // Switch to predictive mode
 * setMode('predictive');
 *
 * // Check current mode
 * if (mode === 'predictive') {
 *   // Use predictive positioning
 * }
 * ```
 *
 * State persists across sessions via localStorage.
 * Defaults to 'gps-only' for backward compatibility.
 */
export const useAlgorithmState = create<AlgorithmState>()(
  persist(
    (set) => ({
      // Default to GPS-only for backward compatibility
      mode: 'gps-only',

      setMode: (mode: PositionAlgorithmMode) => {
        set({ mode });
      },
    }),
    {
      name: STORAGE_KEY,
      // Only persist the mode field
      partialize: (state) => ({ mode: state.mode }),
    },
  ),
);
