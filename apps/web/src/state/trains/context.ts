import { createContext } from 'react';
import type { TrainState, TrainActions } from './types';

export const TrainStateContext = createContext<TrainState | null>(null);
export const TrainActionsContext = createContext<TrainActions | null>(null);
