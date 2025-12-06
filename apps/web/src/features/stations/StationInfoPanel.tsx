import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { StationInfoPanelProps } from './StationInfoPanel.types';
import { StationInfoPanelDesktop } from './StationInfoPanelDesktop';
import { StationInfoPanelMobile } from './StationInfoPanelMobile';

export function StationInfoPanel(props: StationInfoPanelProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return isDesktop ? (
    <StationInfoPanelDesktop {...props} />
  ) : (
    <StationInfoPanelMobile {...props} />
  );
}

export type { StationInfoPanelProps } from './StationInfoPanel.types';
