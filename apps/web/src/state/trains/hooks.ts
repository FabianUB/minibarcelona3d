import { useContext } from 'react';
import { TrainStateContext, TrainActionsContext } from './context';
import type { TrainState, TrainActions } from './types';

export function useTrainState(): TrainState {
  const ctx = useContext(TrainStateContext);
  if (!ctx) {
    throw new Error('useTrainState must be used within a TrainStateProvider');
  }
  return ctx;
}

export function useTrainActions(): TrainActions {
  const ctx = useContext(TrainActionsContext);
  if (!ctx) {
    throw new Error('useTrainActions must be used within a TrainStateProvider');
  }
  return ctx;
}

export function useTrainStore(): [TrainState, TrainActions] {
  return [useTrainState(), useTrainActions()];
}
