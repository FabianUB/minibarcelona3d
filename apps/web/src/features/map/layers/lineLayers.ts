import type { Expression } from 'mapbox-gl';
import type { MapHighlightMode } from '../../../types/rodalies';

/**
 * Line layer styling utilities for Rodalies transit lines
 * Provides dynamic styling based on highlight/isolate state
 */

export interface LineLayerStyleConfig {
  highlightMode: MapHighlightMode;
  highlightedLineId: string | null; // Deprecated: use highlightedLineIds
  highlightedLineIds?: string[]; // New: support multiple highlighted lines
}

/**
 * Get line opacity expression based on highlight state
 *
 * Behavior:
 * - 'none': All lines at full opacity (0.95)
 * - 'highlight': Highlighted lines at full opacity, others at full opacity
 * - 'isolate': Highlighted lines at full opacity, others heavily dimmed (0.15)
 */
export function getLineOpacityExpression(
  config: LineLayerStyleConfig,
): Expression {
  const { highlightMode, highlightedLineIds = [], highlightedLineId } = config;

  // Use new array if provided, otherwise fall back to single ID
  const activeLineIds = highlightedLineIds.length > 0
    ? highlightedLineIds
    : highlightedLineId ? [highlightedLineId] : [];

  if (highlightMode === 'none' || activeLineIds.length === 0) {
    // No highlighting: all lines full opacity
    return 0.95;
  }

  if (highlightMode === 'highlight') {
    // Highlight mode: all lines visible at full opacity
    return 0.95;
  }

  // Isolate mode: heavily dim non-highlighted lines for better contrast
  // Build a match expression for multiple line IDs
  return [
    'case',
    ['in', ['get', 'id'], ['literal', activeLineIds]],
    0.95, // Highlighted lines
    0.15, // Heavily dimmed lines
  ] as Expression;
}

/**
 * Get line width expression based on highlight state
 *
 * Behavior:
 * - Highlighted lines get 2x width boost for strong emphasis
 * - Uses MiniTokyo3D style exponential zoom scaling
 *
 * Note: We use interpolate at the top level with case expressions inside
 * because Mapbox requires zoom expressions to be at the top level
 */
export function getLineWidthExpression(
  config: LineLayerStyleConfig,
): Expression {
  const { highlightMode, highlightedLineIds = [], highlightedLineId } = config;

  // Use new array if provided, otherwise fall back to single ID
  const activeLineIds = highlightedLineIds.length > 0
    ? highlightedLineIds
    : highlightedLineId ? [highlightedLineId] : [];

  if (highlightMode === 'none' || activeLineIds.length === 0) {
    // No highlight: standard zoom-based width
    return [
      'interpolate',
      ['exponential', 2],
      ['zoom'],
      10,
      2,
      12,
      4,
      14,
      6,
      16,
      8,
    ] as Expression;
  }

  // Apply 2x width multiplier to highlighted lines at each zoom level for strong emphasis
  const isHighlighted = ['in', ['get', 'id'], ['literal', activeLineIds]];
  return [
    'interpolate',
    ['exponential', 2],
    ['zoom'],
    10,
    ['case', isHighlighted, 4, 2],
    12,
    ['case', isHighlighted, 8, 4],
    14,
    ['case', isHighlighted, 12, 6],
    16,
    ['case', isHighlighted, 16, 8],
  ] as Expression;
}

/**
 * Get complete paint properties for line layer
 * Combines all dynamic styling expressions
 *
 * Note: We don't use line-emissive-strength because it doesn't support
 * data expressions (can't read feature properties). Instead, we rely on
 * opacity and width changes for highlight effects.
 */
export function getLinePaintProperties(config: LineLayerStyleConfig) {
  return {
    'line-color': ['coalesce', ['get', 'brand_color'], '#f97316'],
    'line-width': getLineWidthExpression(config),
    'line-opacity': getLineOpacityExpression(config),
  };
}

/**
 * Theme tokens for line emphasis states
 * Maps to data-model.md theme token definitions
 */
export const LINE_EMPHASIS_TOKENS = {
  standard: {
    opacity: 0.95,
    width: 1.0,
    emissive: 1.0,
  },
  highlighted: {
    opacity: 0.95,
    width: 1.5,
    emissive: 1.5,
  },
  dimmed: {
    opacity: 0.25,
    width: 1.0,
    emissive: 0.5,
  },
} as const;
