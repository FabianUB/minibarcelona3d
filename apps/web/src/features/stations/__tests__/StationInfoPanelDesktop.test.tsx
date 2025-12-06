// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StationInfoPanelDesktop } from '../StationInfoPanelDesktop';
import type { Station } from '../../../types/rodalies';
import type { RodaliesLine } from '../../../types/rodalies';

const mockStation: Station = {
  id: 'SANTS',
  name: 'Barcelona-Sants',
  code: '1234',
  lines: ['R1', 'R2'],
  geometry: {
    type: 'Point',
    coordinates: [2.141, 41.379],
  },
};

const mockLines: RodaliesLine[] = [
  {
    id: 'R1',
    name: 'R1 - Maresme',
    short_code: 'R1',
    brand_color: '#d9480f',
    default_pattern: 'solid',
    high_contrast_pattern: 'solid',
  },
  {
    id: 'R2',
    name: 'R2 - Airport',
    short_code: 'R2',
    brand_color: '#2563eb',
    default_pattern: 'solid',
    high_contrast_pattern: 'solid',
  },
];

describe('StationInfoPanelDesktop', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders station details and line badges', () => {
    render(
      <StationInfoPanelDesktop
        station={mockStation}
        lines={mockLines}
        isOpen
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Barcelona-Sants')).toBeTruthy();
    const badges = screen.getAllByTestId('station-line-badge');
    expect(badges).toHaveLength(2);
    expect(badges[0].getAttribute('data-line-id')).toBe('R1');
  });

  it('invokes onClose when the close button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <StationInfoPanelDesktop
        station={mockStation}
        lines={mockLines}
        isOpen
        onClose={handleClose}
      />,
    );

    fireEvent.click(screen.getByTestId('station-panel-close'));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
