import { createContext } from 'react';
import type { TransitState, TransitActions } from './types';

export const TransitStateContext = createContext<TransitState | null>(null);
export const TransitActionsContext = createContext<TransitActions | null>(null);
