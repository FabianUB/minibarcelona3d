import './App.css';

import { MapCanvas } from './features/map';
// LegendPanel and SettingsMenu are now integrated into ControlPanel
import { TrainInfoPanel } from './features/trains/TrainInfoPanel';
import { StationInfoPanelContainer } from './features/stations/StationInfoPanelContainer';
import { TransitInfoPanel } from './features/transit';
import { StatusPage } from './features/status';
import { DelaysPage } from './features/delays';
import { MapStateProvider } from './state/map';
import { TrainStateProvider } from './state/trains';
import { TransitStateProvider } from './state/transit';

function App() {
  // Simple path-based routing without react-router
  const isStatusPage = window.location.pathname === '/status';
  const isDelaysPage = window.location.pathname === '/delays';

  if (isStatusPage) {
    return <StatusPage />;
  }

  if (isDelaysPage) {
    return <DelaysPage />;
  }

  return (
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
  );
}

export default App;
