/**
 * Algorithm toggle component for switching between positioning modes
 *
 * Provides a segmented control UI for switching between:
 * - GPS Only: Real-time GPS coordinates (current behavior)
 * - Predictive: Schedule-based interpolation with station parking
 *
 * Phase 1, Task T002
 */

import { useAlgorithmState } from '../../state/algorithm/algorithmStore';
import type { PositionAlgorithmMode } from '../../types/algorithm';

export function AlgorithmToggle() {
  const { mode, setMode } = useAlgorithmState();

  const handleModeChange = (newMode: PositionAlgorithmMode) => {
    setMode(newMode);
  };

  return (
    <div
      className="algorithm-toggle"
      role="radiogroup"
      aria-label="Train positioning algorithm"
      data-testid="algorithm-toggle"
    >
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'gps-only'}
        aria-label="GPS Only positioning"
        className={`algorithm-toggle-button ${
          mode === 'gps-only' ? 'algorithm-toggle-button-active' : ''
        }`}
        onClick={() => handleModeChange('gps-only')}
        data-testid="algorithm-toggle-gps"
        title="Use real-time GPS coordinates for train positioning"
      >
        GPS
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'predictive'}
        aria-label="Predictive positioning"
        className={`algorithm-toggle-button ${
          mode === 'predictive' ? 'algorithm-toggle-button-active' : ''
        }`}
        onClick={() => handleModeChange('predictive')}
        data-testid="algorithm-toggle-predictive"
        title="Use schedule-based interpolation with station parking"
      >
        Predictive
      </button>
    </div>
  );
}
