/**
 * NetworkTabs Component
 *
 * Icon-based tab bar for selecting transit networks.
 * - Single click: Enable only that network (exclusive mode)
 * - Ctrl+click / Cmd+click: Toggle network (multi-select mode)
 * - Long press (mobile): Toggle network (multi-select mode)
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useMapNetwork, useMapActions } from '@/state/map';
import type { TransportType } from '@/types/rodalies';
import { NETWORK_TABS, type NetworkTabConfig } from '../types';

interface NetworkTabsProps {
  className?: string;
}

export function NetworkTabs({ className }: NetworkTabsProps) {
  const { t } = useTranslation('controlPanel');
  const { activeControlTab, transportFilters } = useMapNetwork();
  const { setExclusiveNetwork, toggleNetworkMulti } = useMapActions();
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);

  const handleClick = useCallback(
    (network: TransportType, e: React.MouseEvent) => {
      // Ctrl+click or Cmd+click for multi-select
      if (e.ctrlKey || e.metaKey) {
        toggleNetworkMulti(network);
      } else {
        setExclusiveNetwork(network);
      }
    },
    [setExclusiveNetwork, toggleNetworkMulti]
  );

  const handleTouchStart = useCallback(
    (network: TransportType) => {
      // Start long press timer for multi-select on mobile
      const timer = setTimeout(() => {
        toggleNetworkMulti(network);
        setLongPressTimer(null);
      }, 500);
      setLongPressTimer(timer);
    },
    [toggleNetworkMulti]
  );

  const handleTouchEnd = useCallback(
    (network: TransportType) => {
      if (longPressTimer) {
        // Short tap - exclusive select
        clearTimeout(longPressTimer);
        setLongPressTimer(null);
        setExclusiveNetwork(network);
      }
    },
    [longPressTimer, setExclusiveNetwork]
  );

  const handleTouchCancel = useCallback(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  }, [longPressTimer]);

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-1 p-1.5 bg-muted/50 rounded-xl',
        className
      )}
      role="tablist"
      aria-label={t('tabs.ariaLabel')}
    >
      {NETWORK_TABS.map((tab: NetworkTabConfig) => {
        const isActive = activeControlTab === tab.type;
        const isEnabled = transportFilters[tab.type];

        return (
          <button
            key={tab.type}
            role="tab"
            aria-selected={isActive}
            aria-label={`${tab.label} ${isEnabled ? t('tabs.enabled') : t('tabs.disabled')}`}
            onClick={(e) => handleClick(tab.type, e)}
            onTouchStart={() => handleTouchStart(tab.type)}
            onTouchEnd={() => handleTouchEnd(tab.type)}
            onTouchCancel={handleTouchCancel}
            className={cn(
              'relative flex items-center justify-center gap-1.5 w-12 lg:w-auto lg:px-3 h-10 rounded-lg',
              'transition-all duration-200 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isActive
                ? 'bg-background text-foreground shadow-md scale-105'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/60 hover:scale-102',
              !isEnabled && 'opacity-50 grayscale-[60%]'
            )}
            title={`${tab.label} - ${t('tabs.clickToSelect')}`}
          >
            <img src={tab.icon} alt="" aria-hidden="true" className="w-6 h-6 object-contain" draggable={false} />
            <span className="hidden lg:inline text-[10px] font-medium">{tab.label}</span>
            {/* Active indicator dot */}
            {isActive && (
              <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-primary rounded-full" />
            )}
          </button>
        );
      })}
    </div>
  );
}
