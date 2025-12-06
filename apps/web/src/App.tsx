import './App.css';

import { MapCanvas } from './features/map';
import { LegendPanel } from './features/legend';
import { SettingsMenu } from './features/settings';
import { TrainInfoPanel } from './features/trains/TrainInfoPanel';
import { StationInfoPanelContainer } from './features/stations/StationInfoPanelContainer';
import { MapStateProvider } from './state/map';
import { TrainStateProvider } from './state/trains';

function App() {
  return (
    <MapStateProvider>
      <TrainStateProvider>
        <div className="app-shell" data-testid="app-shell">
          <MapCanvas />
          <LegendPanel />
          <SettingsMenu />
          <TrainInfoPanel />
          <StationInfoPanelContainer />
        </div>
      </TrainStateProvider>
    </MapStateProvider>
  );
}

export default App;
