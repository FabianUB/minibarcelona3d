import { useMemo, useReducer } from 'react';
import type { PropsWithChildren } from 'react';
import { TransitStateContext, TransitActionsContext } from './context';
import type { TransitState, TransitActions, TransitActionType } from './types';

function createInitialState(): TransitState {
  return {
    selectedVehicle: null,
    isPanelOpen: false,
  };
}

function transitReducer(state: TransitState, action: TransitActionType): TransitState {
  switch (action.type) {
    case 'SELECT_VEHICLE':
      return {
        ...state,
        selectedVehicle: action.payload.vehicle,
        isPanelOpen: true,
      };
    case 'CLOSE_PANEL':
      return {
        ...state,
        isPanelOpen: false,
      };
    case 'CLEAR_SELECTION':
      return {
        ...state,
        selectedVehicle: null,
        isPanelOpen: false,
      };
    default:
      return state;
  }
}

export function TransitStateProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(transitReducer, undefined, createInitialState);

  const actions: TransitActions = useMemo(
    () => ({
      selectVehicle(vehicle) {
        dispatch({ type: 'SELECT_VEHICLE', payload: { vehicle } });
      },
      closePanel() {
        dispatch({ type: 'CLOSE_PANEL' });
      },
      clearSelection() {
        dispatch({ type: 'CLEAR_SELECTION' });
      },
    }),
    []
  );

  return (
    <TransitStateContext.Provider value={state}>
      <TransitActionsContext.Provider value={actions}>
        {children}
      </TransitActionsContext.Provider>
    </TransitStateContext.Provider>
  );
}
