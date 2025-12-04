// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { useMediaQuery } from '@/hooks/useMediaQuery';
import { StationInfoPanelDesktop } from '../StationInfoPanelDesktop';
import { StationInfoPanelMobile } from '../StationInfoPanelMobile';
import { StationInfoPanel } from '../StationInfoPanel';
import type { Station } from '../../../types/rodalies';
import type { RodaliesLine } from '../../../types/rodalies';

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(),
}));

vi.mock('../StationInfoPanelDesktop', () => ({
  StationInfoPanelDesktop: vi.fn(() => <div data-testid="desktop-panel" />),
}));

vi.mock('../StationInfoPanelMobile', () => ({
  StationInfoPanelMobile: vi.fn(() => <div data-testid="mobile-panel" />),
}));

const mockStation: Station = {
  id: 'ARC',
  name: 'Arc de Triomf',
  code: 'ARC',
  lines: ['R1'],
  geometry: {
    type: 'Point',
    coordinates: [2.1801, 41.3897],
  },
};

const mockLines: RodaliesLine[] = [
  {
    id: 'R1',
    name: 'R1 - Maresme',
    short_code: 'R1',
    brand_color: '#f97316',
    default_pattern: 'solid',
    high_contrast_pattern: 'solid',
  },
];

describe('StationInfoPanel wrapper', () => {
  const mockedMediaQuery = vi.mocked(useMediaQuery);
  const mockedDesktop = vi.mocked(StationInfoPanelDesktop);
  const mockedMobile = vi.mocked(StationInfoPanelMobile);

  beforeEach(() => {
    mockedDesktop.mockClear();
    mockedMobile.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders desktop variant when media query matches', () => {
    mockedMediaQuery.mockReturnValue(true);

    render(
      <StationInfoPanel
        station={mockStation}
        lines={mockLines}
        isOpen
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('desktop-panel')).toBeTruthy();
    expect(mockedDesktop).toHaveBeenCalled();
    expect(mockedMobile).not.toHaveBeenCalled();
  });

  it('renders mobile variant when media query does not match', () => {
    mockedMediaQuery.mockReturnValue(false);

    render(
      <StationInfoPanel
        station={mockStation}
        lines={mockLines}
        isOpen
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('mobile-panel')).toBeTruthy();
    expect(mockedMobile).toHaveBeenCalled();
    expect(mockedDesktop).not.toHaveBeenCalled();
  });
});
