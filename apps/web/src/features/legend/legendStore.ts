import { useEffect, useMemo, useState } from 'react';

import { useMapActions, useMapHighlightSelectors } from '../../state/map';
import { loadLegendEntries, loadRodaliesLines } from '../../lib/rodalies/dataLoader';
import type { LegendEntry } from '../../types/rodalies';

export interface LegendItem {
  lineId: string;
  label: string;
  themeTokens: {
    standard: string;
    highContrast: string;
  };
  brandColor: string;
  isHighlighted: boolean;
  isDimmed: boolean;
}

export interface LegendStoreState {
  items: LegendItem[];
  mode: 'all' | 'highlight' | 'isolate';
  activeLineId: string | null;
  isLoading: boolean;
  error: string | null;
  highlightLine(lineId: string): void;
  isolateLine(lineId: string): void;
  clearSelection(): void;
}

/**
 * Custom hook for managing legend state and interactions.
 * Loads legend entries from data loader and syncs with map state.
 */
export function useLegendStore(): LegendStoreState {
  const [entries, setEntries] = useState<LegendEntry[]>([]);
  const [colorMap, setColorMap] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Load legend entries and line colors on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [legendEntries, rodaliesLines] = await Promise.all([
          loadLegendEntries(),
          loadRodaliesLines(),
        ]);

        if (!cancelled) {
          // Create color map from rodalies lines
          const colors = new Map<string, string>();
          for (const line of rodaliesLines) {
            // Add # prefix to hex color
            colors.set(line.id, `#${line.brand_color}`);
          }

          setEntries(legendEntries);
          setColorMap(colors);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load legend data',
          );
          console.error('Failed to load legend data:', err);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Transform entries to items with current highlight state and colors
  const items = useMemo<LegendItem[]>(() => {
    return entries.map((entry) => ({
      lineId: entry.line_id,
      label: entry.label,
      themeTokens: {
        standard: entry.theme_tokens.standard,
        highContrast: entry.theme_tokens.high_contrast,
      },
      brandColor: colorMap.get(entry.line_id) || '#666666',
      isHighlighted: isLineHighlighted(entry.line_id),
      isDimmed: isLineDimmed(entry.line_id),
    }));
  }, [entries, colorMap, isLineHighlighted, isLineDimmed]);

  // Derive mode from highlightMode
  const mode = useMemo<'all' | 'highlight' | 'isolate'>(() => {
    if (highlightMode === 'none') return 'all';
    return highlightMode;
  }, [highlightMode]);

  return {
    items,
    mode,
    activeLineId: highlightedLineId,
    isLoading,
    error,
    highlightLine: highlightLineAction,
    isolateLine: isolateLineAction,
    clearSelection: clearHighlightedLine,
  };
}
