import { useContext } from 'react';
import { TransitStateContext, TransitActionsContext } from './context';
import type { TransitState, TransitActions } from './types';

export function useTransitState(): TransitState {
  const ctx = useContext(TransitStateContext);
  if (!ctx) {
    throw new Error('useTransitState must be used within a TransitStateProvider');
  }
  return ctx;
}

export function useTransitActions(): TransitActions {
  const ctx = useContext(TransitActionsContext);
  if (!ctx) {
    throw new Error('useTransitActions must be used within a TransitStateProvider');
  }
  return ctx;
}

export function useTransitStore(): [TransitState, TransitActions] {
  return [useTransitState(), useTransitActions()];
}
