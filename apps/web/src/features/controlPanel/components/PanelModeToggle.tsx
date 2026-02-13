/**
 * PanelModeToggle Component
 *
 * Button to toggle between Control Panel and Vehicle List modes.
 */

import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useMapNetwork, useMapActions } from '@/state/map';

export function PanelModeToggle() {
  const { t } = useTranslation('controlPanel');
  const { controlPanelMode } = useMapNetwork();
  const { setControlPanelMode } = useMapActions();

  const isControlMode = controlPanelMode === 'controls';

  const handleToggle = () => {
    setControlPanelMode(isControlMode ? 'vehicles' : 'controls');
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleToggle}
      className="h-7 px-2"
      title={isControlMode ? t('panel.showVehicleList') : t('panel.showControls')}
    >
      {isControlMode ? '📋' : '⚙️'}
    </Button>
  );
}
