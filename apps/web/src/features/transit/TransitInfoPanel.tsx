/**
 * TransitInfoPanel Component
 *
 * Routes between desktop (Card) and mobile (Sheet) variants
 * based on viewport width. Displays information about selected
 * Metro/TRAM/FGC/Bus vehicles.
 */

import { useEffect, useState } from 'react';
import { TransitInfoPanelDesktop } from './TransitInfoPanelDesktop';
import { TransitInfoPanelMobile } from './TransitInfoPanelMobile';
import { useTransitState, useTransitActions } from '../../state/transit';

export function TransitInfoPanel() {
  const [isMobile, setIsMobile] = useState(false);
  const { selectedVehicle, isPanelOpen } = useTransitState();
  const { clearSelection } = useTransitActions();

  // Check viewport width for responsive layout
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Clear selection if vehicle disappears (e.g., filtered out)
  useEffect(() => {
    if (!isPanelOpen || !selectedVehicle) {
      return;
    }

    // Vehicle selection handling - if the vehicle is no longer available,
    // the panel will be closed automatically when the data updates
  }, [isPanelOpen, selectedVehicle, clearSelection]);

  return isMobile ? <TransitInfoPanelMobile /> : <TransitInfoPanelDesktop />;
}
