import type { TransportType } from '../../types/rodalies';

export interface FilterOption {
  type: TransportType;
  label: string;
  description: string;
  disabled?: boolean;
  disabledReason?: string;
}

export const FILTER_OPTIONS: FilterOption[] = [
  {
    type: 'rodalies',
    label: 'Rodalies',
    description: 'Show commuter rail trains, lines and stations',
  },
  {
    type: 'metro',
    label: 'Metro',
    description: 'Show metro lines and stations',
  },
  {
    type: 'tram',
    label: 'TRAM',
    description: 'Show tram lines and stops (Trambaix)',
  },
  {
    type: 'fgc',
    label: 'FGC',
    description: 'Show FGC suburban rail lines and stations',
  },
  {
    type: 'bus',
    label: 'Bus',
    description: 'Show bus routes and stops',
  },
];
