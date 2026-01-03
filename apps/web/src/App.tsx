import './App.css';

import { MapCanvas } from './features/map';
import { LegendPanel } from './features/legend';
import { SettingsMenu } from './features/settings';
import { TrainInfoPanel } from './features/trains/TrainInfoPanel';
import { StationInfoPanelContainer } from './features/stations/StationInfoPanelContainer';
import { TransitInfoPanel } from './features/transit';
import { MapStateProvider } from './state/map';
import { TrainStateProvider } from './state/trains';
import { TransitStateProvider } from './state/transit';

function App() {
  return (
    <MapStateProvider>
      <TrainStateProvider>
        <TransitStateProvider>
          <div className="app-shell" data-testid="app-shell">
            <MapCanvas />
            <LegendPanel />
            <SettingsMenu />
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
