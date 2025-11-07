import { useEffect, useState } from 'react';
import { TrainInfoPanelDesktop } from './TrainInfoPanelDesktop';
import { TrainInfoPanelMobile } from './TrainInfoPanelMobile';
import { useTrainState, useTrainActions } from '../../state/trains';
import { useMapHighlightSelectors } from '../../state/map';
import { extractLineFromRouteId } from '../../config/trainModels';

export function TrainInfoPanel() {
  const [isMobile, setIsMobile] = useState(false);
  const { selectedTrain, isPanelOpen } = useTrainState();
  const { clearSelection } = useTrainActions();
  const { highlightMode, isLineHighlighted } = useMapHighlightSelectors();

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  /**
   * Effect: Close panel when selected train is filtered out
   * Tasks: T091, T092 - Close panel when train becomes invisible in isolate mode
   */
  useEffect(() => {
    // Only check if panel is open and train is selected
    if (!isPanelOpen || !selectedTrain) {
      return;
    }

    // Only close in isolate mode (in highlight mode, trains are still visible at 25%)
    if (highlightMode !== 'isolate') {
      return;
    }

    // Extract line code from selected train's route ID
    const lineCode = extractLineFromRouteId(selectedTrain.routeId);
    if (!lineCode) {
      return;
    }

    // If the train's line is not highlighted, it's invisible - close the panel
    if (!isLineHighlighted(lineCode)) {
      console.log(`TrainInfoPanel: Closing panel - train ${selectedTrain.vehicleKey} (${lineCode}) filtered out in isolate mode`);
      clearSelection();
    }
  }, [isPanelOpen, selectedTrain, highlightMode, isLineHighlighted, clearSelection]);

  return isMobile ? <TrainInfoPanelMobile /> : <TrainInfoPanelDesktop />;
}
