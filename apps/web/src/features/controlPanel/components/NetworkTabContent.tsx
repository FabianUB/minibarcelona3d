/**
 * NetworkTabContent Component
 *
 * Content area for the active network tab.
 * Shows network name header, line selection grid, model size slider, and settings.
 */

import { useTranslation } from 'react-i18next';
import { Separator } from '@/components/ui/separator';
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
  const { t: tCommon } = useTranslation('common');
  const { dataSourceStatus } = useTransitState();
  const networkTab = NETWORK_TABS.find((tab) => tab.type === network);
  const networkLabel = tCommon(`networks.${network}`);
  const dataSource = dataSourceStatus[network];

  return (
    <div className="space-y-3">
      {/* Network header */}
      <div className="flex items-center gap-2 px-1">
        {networkTab?.icon && <img src={networkTab.icon} alt="" className="w-5 h-5 object-contain" />}
        <span className="font-semibold text-sm">{networkLabel}</span>
      </div>

      {/* Status alert for data issues */}
      <NetworkStatusAlert source={dataSource} network={network} />

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
