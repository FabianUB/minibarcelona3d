/**
 * NetworkBar Component
 *
 * Floating horizontal bar at top-center of the screen for quick network switching.
 * Wraps the existing NetworkTabs component in a pill-shaped container.
 */

import { NetworkTabs } from './NetworkTabs';

export function NetworkBar() {
  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[15] bg-background/95 backdrop-blur-sm border border-border/50 rounded-2xl shadow-xl">
      <NetworkTabs />
    </div>
  );
}
