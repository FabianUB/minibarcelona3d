// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StationInfoPanelMobile } from '../StationInfoPanelMobile';
import type { Station } from '../../../types/rodalies';
import type { RodaliesLine } from '../../../types/rodalies';

const mockStation: Station = {
  id: 'PGD',
  name: 'Passeig de Gràcia',
  code: 'PGD',
  lines: ['R1'],
  geometry: {
    type: 'Point',
    coordinates: [2.1686, 41.3913],
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

describe('StationInfoPanelMobile', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders in mobile sheet layout', () => {
    render(
      <StationInfoPanelMobile
        station={mockStation}
        lines={mockLines}
        isOpen
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('station-info-panel')).toBeTruthy();
    expect(screen.getByText('Passeig de Gràcia')).toBeTruthy();
    expect(screen.getAllByTestId('station-line-badge')).toHaveLength(1);
  });

  it('calls onClose when sheet close is triggered', async () => {
    const handleClose = vi.fn();
    render(
      <StationInfoPanelMobile
        station={mockStation}
        lines={mockLines}
        isOpen
        onClose={handleClose}
      />,
    );

    // Sheet close button has aria-label "Close"
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(handleClose).toHaveBeenCalled();
  });
});
