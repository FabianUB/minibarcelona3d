import type { Train } from '../../types/trains';

export interface TrainState {
  selectedTrain: Train | null;
  isPanelOpen: boolean;
}

export interface TrainActions {
  selectTrain(train: Train): void;
  closePanel(): void;
  clearSelection(): void;
}

export type TrainActionType =
  | { type: 'SELECT_TRAIN'; payload: { train: Train } }
  | { type: 'CLOSE_PANEL' }
  | { type: 'CLEAR_SELECTION' };
