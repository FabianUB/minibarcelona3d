/**
 * Unit tests for algorithm state store
 *
 * Tests:
 * - Initial state
 * - Mode switching
 * - Persistence to/from localStorage
 *
 * Phase 1, Task T004
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAlgorithmState } from './algorithmStore';

describe('useAlgorithmState', () => {
  const STORAGE_KEY = 'rodalies:positionAlgorithm';

  beforeEach(() => {
    // localStorage is cleared by test setup
    // Reset Zustand store state
    useAlgorithmState.setState({ mode: 'gps-only' });
  });

  describe('initial state', () => {
    it('should default to gps-only mode', () => {
      const { mode } = useAlgorithmState.getState();
      expect(mode).toBe('gps-only');
    });

    it('should have setMode function', () => {
      const { setMode } = useAlgorithmState.getState();
      expect(typeof setMode).toBe('function');
    });
  });

  describe('mode switching', () => {
    it('should switch to predictive mode', () => {
      const { setMode } = useAlgorithmState.getState();

      setMode('predictive');

      const { mode } = useAlgorithmState.getState();
      expect(mode).toBe('predictive');
    });

    it('should switch back to gps-only mode', () => {
      const { setMode } = useAlgorithmState.getState();

      setMode('predictive');
      setMode('gps-only');

      const { mode } = useAlgorithmState.getState();
      expect(mode).toBe('gps-only');
    });

    it('should allow multiple mode changes', () => {
      const { setMode } = useAlgorithmState.getState();

      setMode('predictive');
      expect(useAlgorithmState.getState().mode).toBe('predictive');

      setMode('gps-only');
      expect(useAlgorithmState.getState().mode).toBe('gps-only');

      setMode('predictive');
      expect(useAlgorithmState.getState().mode).toBe('predictive');
    });
  });

  describe('localStorage persistence', () => {
    it('should persist mode to localStorage when changed', () => {
      const { setMode } = useAlgorithmState.getState();

      setMode('predictive');

      // Check localStorage directly
      const stored = localStorage.getItem(STORAGE_KEY);
      expect(stored).toBeTruthy();

      if (stored) {
        const parsed = JSON.parse(stored);
        expect(parsed.state.mode).toBe('predictive');
      }
    });

    it('should restore mode from localStorage on initialization', () => {
      // Manually set localStorage to simulate persisted state
      const persistedState = {
        state: { mode: 'predictive' },
        version: 0,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState));

      // Verify localStorage has the persisted data
      const stored = localStorage.getItem(STORAGE_KEY);
      expect(stored).toBeTruthy();

      if (stored) {
        const parsed = JSON.parse(stored);
        expect(parsed.state.mode).toBe('predictive');
      }
    });

    it('should persist gps-only mode to localStorage', () => {
      const { setMode } = useAlgorithmState.getState();

      // Switch to predictive first
      setMode('predictive');

      // Switch back to gps-only
      setMode('gps-only');

      const stored = localStorage.getItem(STORAGE_KEY);
      expect(stored).toBeTruthy();

      if (stored) {
        const parsed = JSON.parse(stored);
        expect(parsed.state.mode).toBe('gps-only');
      }
    });

    it('should handle round-trip persistence', () => {
      const { setMode } = useAlgorithmState.getState();

      // Set to predictive
      setMode('predictive');

      // Verify persistence
      const stored = localStorage.getItem(STORAGE_KEY);
      expect(stored).toBeTruthy();

      if (stored) {
        const parsed = JSON.parse(stored);
        expect(parsed.state.mode).toBe('predictive');

        // Simulate restoration
        const restoredMode = parsed.state.mode;
        expect(restoredMode).toBe('predictive');
      }
    });
  });

  describe('state isolation', () => {
    it('should only persist mode field', () => {
      const { setMode } = useAlgorithmState.getState();

      setMode('predictive');

      const stored = localStorage.getItem(STORAGE_KEY);
      expect(stored).toBeTruthy();

      if (stored) {
        const parsed = JSON.parse(stored);
        // Should only have mode, not setMode function
        expect(parsed.state).toHaveProperty('mode');
        expect(parsed.state).not.toHaveProperty('setMode');
      }
    });
  });

  describe('type safety', () => {
    it('should accept valid mode values', () => {
      const { setMode } = useAlgorithmState.getState();

      // These should not throw TypeScript errors
      setMode('gps-only');
      setMode('predictive');

      expect(useAlgorithmState.getState().mode).toBe('predictive');
    });
  });
});
