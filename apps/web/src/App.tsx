import './App.css';

import { MapCanvas } from './features/map';
import { LegendPanel } from './features/legend';
import { SettingsMenu } from './features/settings';
import { MapStateProvider } from './state/map';

function App() {
  return (
    <MapStateProvider>
      <div className="app-shell" data-testid="app-shell">
        <MapCanvas />
        <LegendPanel />
        <SettingsMenu />
      </div>
    </MapStateProvider>
  );
}

export default App;
