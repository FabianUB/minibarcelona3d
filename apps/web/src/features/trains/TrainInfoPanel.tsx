import { useEffect, useState } from 'react';
import { TrainInfoPanelDesktop } from './TrainInfoPanelDesktop';
import { TrainInfoPanelMobile } from './TrainInfoPanelMobile';

export function TrainInfoPanel() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile ? <TrainInfoPanelMobile /> : <TrainInfoPanelDesktop />;
}
