import { useMapActions, useMapHighlightSelectors } from '../../state/map';

/**
 * Custom hook for managing line highlight interactions
 *
 * Provides a clean API for highlighting, isolating, and clearing line selections.
 * This hook connects legend interactions to the map's highlight logic by exposing
 * the underlying map state actions and selectors in a convenient interface.
 *
 * @example
 * ```tsx
 * function LineControl() {
 *   const {
 *     highlightedLineId,
 *     highlightMode,
 *     isLineHighlighted,
 *     isLineDimmed,
 *     highlightLine,
 *     isolateLine,
 *     clearHighlight,
 *   } = useLineHighlight();
 *
 *   return (
 *     <button onClick={() => highlightLine('R1')}>
 *       Highlight R1 {isLineHighlighted('R1') && '✓'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useLineHighlight() {
  const {
    highlightLine: highlightLineAction,
    isolateLine: isolateLineAction,
    clearHighlightedLine,
  } = useMapActions();

  const {
    highlightMode,
    highlightedLineId,
    isLineHighlighted,
    isLineDimmed,
  } = useMapHighlightSelectors();

  return {
    // State
    /**
     * Current highlight mode: 'none', 'highlight', or 'isolate'
     */
    highlightMode,

    /**
     * ID of the currently highlighted line, or null if none
     */
    highlightedLineId,

    // Selectors
    /**
     * Check if a specific line is highlighted
     * @param lineId - The line ID to check
     * @returns true if the line is highlighted
     */
    isLineHighlighted,

    /**
     * Check if a specific line is dimmed (in isolate mode)
     * @param lineId - The line ID to check
     * @returns true if the line is dimmed
     */
    isLineDimmed,

    // Actions
    /**
     * Highlight a line without dimming others
     * @param lineId - The line ID to highlight
     */
    highlightLine: highlightLineAction,

    /**
     * Isolate a line, dimming all others
     * @param lineId - The line ID to isolate
     */
    isolateLine: isolateLineAction,

    /**
     * Clear all highlighting and return to normal view
     */
    clearHighlight: clearHighlightedLine,
  };
}

/**
 * Type definition for the hook's return value
 */
export type UseLineHighlightReturn = ReturnType<typeof useLineHighlight>;
