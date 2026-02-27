import './App.css';

import React, { Suspense } from 'react';
import { MapCanvas } from './features/map';
// LegendPanel and SettingsMenu are now integrated into ControlPanel
import { TrainInfoPanel } from './features/trains/TrainInfoPanel';
import { StationInfoPanelContainer } from './features/stations/StationInfoPanelContainer';
import { TransitInfoPanel } from './features/transit';
import { MapStateProvider } from './state/map';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TrainStateProvider } from './state/trains';
import { TransitStateProvider } from './state/transit';

// Lazy-load rarely-visited pages to reduce initial bundle size
const StatusPage = React.lazy(() =>
  import('./features/status/StatusPage').then(m => ({ default: m.StatusPage }))
);
const DelaysPage = React.lazy(() =>
  import('./features/delays/DelaysPage').then(m => ({ default: m.DelaysPage }))
);

function App() {
  // Simple path-based routing without react-router
  const isStatusPage = window.location.pathname === '/status';
  const isDelaysPage = window.location.pathname === '/delays';

  if (isStatusPage) {
    return (
      <Suspense fallback={<div />}>
        <StatusPage />
      </Suspense>
    );
  }

  if (isDelaysPage) {
    return (
      <Suspense fallback={<div />}>
        <DelaysPage />
      </Suspense>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <MapStateProvider>
        <TrainStateProvider>
          <TransitStateProvider>
            <div className="app-shell" data-testid="app-shell">
              <MapCanvas />
              {/* LegendPanel and SettingsMenu removed - now in ControlPanel */}
              <TrainInfoPanel />
              <TransitInfoPanel />
              <StationInfoPanelContainer />
            </div>
          </TransitStateProvider>
        </TrainStateProvider>
      </MapStateProvider>
    </TooltipProvider>
  );
}

export default App;
