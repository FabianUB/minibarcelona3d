// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MapStateProvider, useMapStore } from '../../../state/map';
import type { LegendEntry } from '../../../types/rodalies';
import { useLegendStore } from '../legendStore';

const mockLegendEntries: LegendEntry[] = [
  {
    line_id: 'R1',
    label: 'R1 - Coastal',
    theme_tokens: {
      standard: 'solid-orange',
      high_contrast: 'solid-navy',
    },
    is_highlighted: false,
  },
  {
    line_id: 'R2',
    label: 'R2 - Valles',
    theme_tokens: {
      standard: 'solid-green',
      high_contrast: 'dashed-yellow',
    },
    is_highlighted: false,
  },
];

const mockRodaliesLines = [
  {
    id: 'R1',
    name: 'R1 - Coastal',
    brand_color: 'ff6600',
    short_code: 'R1',
    default_pattern: 'solid',
    high_contrast_pattern: 'solid',
  },
  {
    id: 'R2',
    name: 'R2 - Valles',
    brand_color: '00cc00',
    short_code: 'R2',
    default_pattern: 'solid',
    high_contrast_pattern: 'solid',
  },
];

vi.mock('../../../lib/rodalies/dataLoader', () => ({
  loadLegendEntries: vi.fn(),
  loadManifest: vi.fn(),
  loadStations: vi.fn(),
  loadLineCollection: vi.fn(),
  loadLineGeometryCollection: vi.fn(),
  loadRodaliesLines: vi.fn(),
  loadMapViewport: vi.fn(),
  loadMapUiState: vi.fn(),
  loadStationList: vi.fn(),
  getFallbackViewport: vi.fn(),
}));

function createWrapper() {
  return function LegendStoreTestProvider({ children }: PropsWithChildren) {
    return <MapStateProvider>{children}</MapStateProvider>;
  };
}

// Import the mocked module
const { loadLegendEntries: loadLegendEntriesMock, loadRodaliesLines: loadRodaliesLinesMock } = await import(
  '../../../lib/rodalies/dataLoader'
);

describe('Legend store highlight and isolate behaviour', () => {
  beforeEach(() => {
    vi.mocked(loadLegendEntriesMock).mockResolvedValue(mockLegendEntries);
    vi.mocked(loadRodaliesLinesMock).mockResolvedValue(mockRodaliesLines);
  });

  afterEach(() => {
    vi.mocked(loadLegendEntriesMock).mockReset();
    vi.mocked(loadRodaliesLinesMock).mockReset();
  });

  it('highlights a requested line without dimming the rest', async () => {
    const wrapper = createWrapper();

    const { result } = renderHook(() => {
      const legend = useLegendStore();
      const [mapState] = useMapStore();
      return { legend, mapState };
    }, { wrapper });

    await waitFor(() =>
      expect(result.current.legend.items).toHaveLength(mockLegendEntries.length),
    );

    expect(result.current.legend.mode).toBe('all');
    expect(result.current.legend.activeLineId).toBeNull();

    act(() => {
      result.current.legend.highlightLine('R1');
    });

    expect(result.current.legend.mode).toBe('highlight');
    expect(result.current.legend.activeLineId).toBe('R1');
    expect(result.current.mapState.ui.selectedLineId).toBe('R1');

    const highlighted = result.current.legend.items.find(
      (entry) => entry.lineId === 'R1',
    );
    const untouched = result.current.legend.items.find(
      (entry) => entry.lineId === 'R2',
    );

    expect(highlighted?.isHighlighted).toBe(true);
    expect(highlighted?.isDimmed).toBe(false);
    expect(untouched?.isHighlighted).toBe(false);
    expect(untouched?.isDimmed).toBe(false);
  });

  it('isolates a line, dimming the rest, and toggles off on repeat selection', async () => {
    const wrapper = createWrapper();

    const { result } = renderHook(() => {
      const legend = useLegendStore();
      const [mapState] = useMapStore();
      return { legend, mapState };
    }, { wrapper });

    await waitFor(() =>
      expect(result.current.legend.items).toHaveLength(mockLegendEntries.length),
    );

    act(() => {
      result.current.legend.isolateLine('R2');
    });

    expect(result.current.legend.mode).toBe('isolate');
    expect(result.current.legend.activeLineId).toBe('R2');
    expect(result.current.mapState.ui.selectedLineId).toBe('R2');

    const isolated = result.current.legend.items.find(
      (entry) => entry.lineId === 'R2',
    );
    const dimmed = result.current.legend.items.find(
      (entry) => entry.lineId === 'R1',
    );

    expect(isolated?.isHighlighted).toBe(true);
    expect(isolated?.isDimmed).toBe(false);
    expect(dimmed?.isHighlighted).toBe(false);
    expect(dimmed?.isDimmed).toBe(true);

    act(() => {
      result.current.legend.isolateLine('R2');
    });

    expect(result.current.legend.mode).toBe('all');
    expect(result.current.legend.activeLineId).toBeNull();
    expect(result.current.mapState.ui.selectedLineId).toBeNull();

    for (const entry of result.current.legend.items) {
      expect(entry.isHighlighted).toBe(false);
      expect(entry.isDimmed).toBe(false);
    }
  });
});
