import type { RodaliesLine, Station } from '../../types/rodalies';

export interface StationInfoPanelProps {
  station: Station | null;
  lines: RodaliesLine[];
  isOpen: boolean;
  onClose: () => void;
  isLoading?: boolean;
  className?: string;
}

export interface StationInfoPanelDesktopProps extends StationInfoPanelProps {
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center';
}

export interface StationInfoPanelMobileProps extends StationInfoPanelProps {
  maxHeightPercent?: number;
}
