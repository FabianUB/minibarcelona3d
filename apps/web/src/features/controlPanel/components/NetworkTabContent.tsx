/**
 * NetworkTabContent Component
 *
 * Content area for the active network tab.
 * Shows network name header, line selection grid, model size slider, and settings.
 */

import { useTranslation } from 'react-i18next';
import { List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useMapActions } from '@/state/map';
import { useTransitState } from '@/state/transit';
import type { TransportType } from '@/types/rodalies';
import { NetworkLineGrid } from './NetworkLineGrid';
import { BusRouteList } from './BusRouteList';
import { ModelSizeSlider } from './ModelSizeSlider';
import { SettingsSection } from './SettingsSection';
import { NetworkStatusAlert } from './NetworkStatusAlert';
import { NETWORK_TABS } from '../types';

interface NetworkTabContentProps {
  network: TransportType;
}

export function NetworkTabContent({ network }: NetworkTabContentProps) {
  const { t } = useTranslation('controlPanel');
  const { t: tCommon } = useTranslation('common');
  const { setControlPanelMode } = useMapActions();
  const { dataSourceStatus } = useTransitState();
  const networkTab = NETWORK_TABS.find((tab) => tab.type === network);
  const networkLabel = tCommon(`networks.${network}`);
  const dataSource = dataSourceStatus[network];

  return (
    <div className="space-y-3">
      {/* Network header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-lg">{networkTab?.icon}</span>
          <span className="font-semibold text-sm">{networkLabel}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setControlPanelMode('vehicles')}
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          title={t('vehicleList.showVehicleList')}
        >
          <List className="h-4 w-4 mr-1" />
          {t('modes.vehicles')}
        </Button>
      </div>

      {/* Status alert for data issues */}
      <NetworkStatusAlert source={dataSource} />

      {/* Line selection - Bus uses special virtualized list */}
      {network === 'bus' ? (
        <BusRouteList />
      ) : (
        <NetworkLineGrid network={network} />
      )}

      <Separator className="my-3" />

      {/* Model size slider */}
      <ModelSizeSlider network={network} />

      <Separator className="my-3" />

      {/* Settings */}
      <SettingsSection showRodaliesSettings={network === 'rodalies'} />
    </div>
  );
}
