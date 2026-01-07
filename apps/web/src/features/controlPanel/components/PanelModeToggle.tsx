/**
 * PanelModeToggle Component
 *
 * Button to toggle between Control Panel and Vehicle List modes.
 */

import { Button } from '@/components/ui/button';
import { useMapState, useMapActions } from '@/state/map';

export function PanelModeToggle() {
  const { ui } = useMapState();
  const { setControlPanelMode } = useMapActions();

  const isControlMode = ui.controlPanelMode === 'controls';

  const handleToggle = () => {
    setControlPanelMode(isControlMode ? 'vehicles' : 'controls');
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleToggle}
      className="h-7 px-2"
      title={isControlMode ? 'Show Vehicle List' : 'Show Controls'}
    >
      {isControlMode ? '📋' : '⚙️'}
    </Button>
  );
}
