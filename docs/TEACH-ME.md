# TEACH-ME.md

This document contains Q&A-style explanations of code concepts, patterns, and decisions in the mini-rodalies-3d codebase.

---

## Q: MapStateProvider and MapCanvas Responsibilities and Interaction

**Question (verbatim):**
> Give me an explanation of what MapStateProvider and MapCanvas main function is, and how they interact with each other

### Answer  Explanation

**MapStateProvider** (`apps/web/src/state/map/MapStateProvider.tsx`) is a React Context provider that manages the global map state using a reducer pattern. It maintains viewport configuration (center, zoom, bounds), UI state (selected lines, highlight mode, high contrast settings), and references to the Mapbox map instance. The provider exposes three separate contexts: `MapStateContext` (read-only state), `MapActionsContext` (state mutation functions), and `MapHighlightSelectorsContext` (derived state for line highlighting logic). This separation allows components to subscribe only to the specific slice of state they need, optimizing re-renders.

**MapCanvas** (`apps/web/src/features/map/MapCanvas.tsx`) is the component responsible for initializing and rendering the Mapbox GL map instance. It creates the map DOM container, initializes the Mapbox map with the default viewport, loads GeoJSON data for railway lines, and manages map controls (navigation, recenter button). MapCanvas also handles bidirectional synchronization between the map instance and the global state: when users interact with the map (pan, zoom), it updates the state via `setViewport()`, and when state changes (like resetting to default viewport), it programmatically updates the map.

The critical interaction pattern is the **viewport synchronization loop**: MapCanvas listens to Mapbox's `moveend` event to capture user interactions and updates the state, while it also responds to state changes by programmatically adjusting the map. To prevent infinite loops, MapCanvas uses a `skipMoveSyncRef` flag that temporarily disables state updates during programmatic map changes. Previously, MapStateProvider also attempted to sync the map to viewport state changes, which created a circular update cycle (state ’ map update ’ moveend event ’ state update ’ ...). This was fixed by removing the sync logic from MapStateProvider and consolidating all viewport synchronization responsibility in MapCanvas.

### Key Takeaways

- **MapStateProvider** is the state container; it manages data and exposes actions but doesn't directly manipulate the map
- **MapCanvas** is the rendering layer; it owns the Mapbox instance and handles all map initialization and DOM interactions
- The two components communicate through Context: MapCanvas consumes state/actions from MapStateProvider via hooks like `useMapState()` and `useMapActions()`
- Viewport synchronization is unidirectional: MapCanvas is the single source of truth for syncing between map events and state
- Using a skip flag pattern (`skipMoveSyncRef`) prevents circular updates when programmatically changing the map

### Minimal Example

```tsx
// MapCanvas consumes state and actions from MapStateProvider
function MapCanvas() {
  const { setViewport, setMapInstance } = useMapActions();
  const skipMoveSyncRef = useRef(false);

  // Initialize map and register with provider
  const map = new mapboxgl.Map({ /* config */ });
  setMapInstance(map);

  // Sync map events ’ state (user interaction)
  map.on('moveend', () => {
    if (skipMoveSyncRef.current) return; // Skip during programmatic changes
    setViewport(getViewportFromMap(map));
  });

  // Sync state ’ map (programmatic control)
  useEffect(() => {
    skipMoveSyncRef.current = true;
    map.jumpTo({ center, zoom });
    map.once('moveend', () => { skipMoveSyncRef.current = false; });
  }, [viewport]);
}

// MapStateProvider wraps the entire app
function App() {
  return (
    <MapStateProvider>
      <MapCanvas />
    </MapStateProvider>
  );
}
```

---
