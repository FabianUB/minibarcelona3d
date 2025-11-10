import { useMemo, useReducer } from 'react';
import type { PropsWithChildren } from 'react';
import { TrainStateContext, TrainActionsContext } from './context';
import type { TrainState, TrainActions, TrainActionType } from './types';

function createInitialState(): TrainState {
  return {
    selectedTrain: null,
    isPanelOpen: false,
  };
}

function trainReducer(state: TrainState, action: TrainActionType): TrainState {
  switch (action.type) {
    case 'SELECT_TRAIN':
      return {
        ...state,
        selectedTrain: action.payload.train,
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
        selectedTrain: null,
        isPanelOpen: false,
      };
    default:
      return state;
  }
}

export function TrainStateProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(trainReducer, undefined, createInitialState);

  const actions: TrainActions = useMemo(
    () => ({
      selectTrain(train) {
        dispatch({ type: 'SELECT_TRAIN', payload: { train } });
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
    <TrainStateContext.Provider value={state}>
      <TrainActionsContext.Provider value={actions}>
        {children}
      </TrainActionsContext.Provider>
    </TrainStateContext.Provider>
  );
}
