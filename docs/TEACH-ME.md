# TEACH-ME.md

This document contains Q&A-style explanations of code concepts, patterns, and decisions in the mini-rodalies-3d codebase.

---

## Q: MapStateProvider and MapCanvas Responsibilities and Interaction

**Question (verbatim):**
> Give me an explanation of what MapStateProvider and MapCanvas main function is, and how they interact with each other

### Answer — Explanation

**MapStateProvider** (`apps/web/src/state/map/MapStateProvider.tsx`) is a React Context provider that manages the global map state using a reducer pattern. It maintains viewport configuration (center, zoom, bounds), UI state (selected lines, highlight mode, high contrast settings), and references to the Mapbox map instance. The provider exposes three separate contexts: `MapStateContext` (read-only state), `MapActionsContext` (state mutation functions), and `MapHighlightSelectorsContext` (derived state for line highlighting logic). This separation allows components to subscribe only to the specific slice of state they need, optimizing re-renders.

**MapCanvas** (`apps/web/src/features/map/MapCanvas.tsx`) is the component responsible for initializing and rendering the Mapbox GL map instance. It creates the map DOM container, initializes the Mapbox map with the default viewport, loads GeoJSON data for railway lines, and manages map controls (navigation, recenter button). MapCanvas also handles bidirectional synchronization between the map instance and the global state: when users interact with the map (pan, zoom), it updates the state via `setViewport()`, and when state changes (like resetting to default viewport), it programmatically updates the map.

The critical interaction pattern is the **viewport synchronization loop**: MapCanvas listens to Mapbox's `moveend` event to capture user interactions and updates the state, while it also responds to state changes by programmatically adjusting the map. To prevent infinite loops, MapCanvas uses a `skipMoveSyncRef` flag that temporarily disables state updates during programmatic map changes. Previously, MapStateProvider also attempted to sync the map to viewport state changes, which created a circular update cycle (state → map update → moveend event → state update → ...). This was fixed by removing the sync logic from MapStateProvider and consolidating all viewport synchronization responsibility in MapCanvas.

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

  // Sync map events → state (user interaction)
  map.on('moveend', () => {
    if (skipMoveSyncRef.current) return; // Skip during programmatic changes
    setViewport(getViewportFromMap(map));
  });

  // Sync state → map (programmatic control)
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

## Q: Benefits of the Repository Pattern in Database Access

**Question (verbatim):**
> Explain to me the benefits of using the repository pattern, and specifically on this case.

### Answer — Explanation

The **Repository Pattern** is a data access abstraction that sits between your business logic (HTTP handlers) and your data storage layer (PostgreSQL). In our train tracking implementation (`apps/api/repository/postgres.go`), the `TrainRepository` encapsulates all database queries for train data, providing a clean interface with methods like `GetAllTrains()`, `GetTrainByKey()`, and `GetTrainsByRoute()`.

**Key benefits in this codebase:**

1. **Testability**: HTTP handlers can be tested with a mock repository instead of requiring a real database. You could create a `MockTrainRepository` that implements the same interface for unit tests, allowing you to verify handler logic without database dependencies.

2. **Database Independence**: If we later decide to switch from PostgreSQL to another database (or add caching with Redis), we only need to modify the repository implementation. The handlers remain unchanged because they depend on the repository interface, not the specific database implementation. This follows the Dependency Inversion Principle.

3. **Centralized Query Logic**: All SQL queries live in one place (`postgres.go`), making it easy to optimize performance, add indexes, or debug query issues. For example, when we discovered the performance requirement of <100ms for `GetAllTrains()`, we knew exactly where to look and optimize.

4. **Connection Pooling Management**: The repository owns the `pgxpool.Pool` connection pool, ensuring proper lifecycle management (creation in `NewTrainRepository()`, cleanup in `Close()`). Handlers don't need to worry about database connections—they just call repository methods with a `context.Context`.

5. **Separation of Concerns**: Handlers focus on HTTP-specific logic (parsing requests, building JSON responses, status codes), while the repository handles database-specific concerns (SQL queries, row scanning, error translation). This makes both layers simpler and easier to maintain.

**Specific to our implementation**: We use pgx's connection pooling (`pgxpool`) which is 20-30% faster than `lib/pq` according to our research. The repository pattern allows us to encapsulate this performance optimization detail—handlers don't know or care that we're using pgx; they just get fast query results.

### Key Takeaways

- The repository pattern abstracts database operations behind a clean, method-based interface
- It enables testing handlers without a real database by using mock repositories
- Switching databases or adding caching only requires changing the repository implementation
- All SQL queries are centralized in one location, making optimization and debugging easier
- Connection pooling and lifecycle management are handled internally by the repository
- Handlers remain focused on HTTP concerns while repositories handle data persistence

### Minimal Example

```go
// Repository provides a clean interface
type TrainRepository interface {
    GetAllTrains(ctx context.Context) ([]models.Train, error)
    GetTrainByKey(ctx context.Context, vehicleKey string) (*models.Train, error)
}

// Handler depends on the interface, not the concrete implementation
type TrainHandler struct {
    repo TrainRepository  // Could be PostgresRepo, MockRepo, or RedisRepo
}

func (h *TrainHandler) GetAllTrains(w http.ResponseWriter, r *http.Request) {
    trains, err := h.repo.GetAllTrains(r.Context())  // No SQL here!
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    json.NewEncoder(w).Encode(trains)
}

// Testing: Inject a mock repository
func TestGetAllTrains(t *testing.T) {
    mockRepo := &MockTrainRepository{
        trains: []models.Train{{VehicleKey: "test"}},
    }
    handler := &TrainHandler{repo: mockRepo}
    // Test handler without touching a database
}
```

### Benefits in Our Specific Architecture

In our train tracking system:

```
HTTP Request → TrainHandler → TrainRepository → PostgreSQL
                     ↓               ↓
              Business Logic    SQL Queries
              JSON Response    Connection Pool
              Status Codes     Row Scanning
```

**Without repository pattern:**
```go
// Bad: Handler tightly coupled to database
func (h *TrainHandler) GetAllTrains(w http.ResponseWriter, r *http.Request) {
    rows, err := h.db.Query("SELECT vehicle_key, latitude, ... FROM rt_rodalies_vehicle_current")
    // SQL mixed with HTTP logic, hard to test, hard to change databases
}
```

**With repository pattern:**
```go
// Good: Clean separation, easy to test, easy to swap implementations
func (h *TrainHandler) GetAllTrains(w http.ResponseWriter, r *http.Request) {
    trains, err := h.repo.GetAllTrains(r.Context())
    // Handler focuses on HTTP, repository handles database
}
```

---

## Q: How are unrealistic train position jumps detected and prevented?

**Question (verbatim):**
> Sometimes trains go at great speeds through the map on a updated, with what I assume is bad information. Can we check this somehow?

### Answer — Explanation

The application validates train position updates to detect unrealistic GPS data that would cause trains to appear to "teleport" across the map at impossible speeds. The validation is performed in `TrainMeshManager.validatePositionUpdate()` (`apps/web/src/lib/trains/trainMeshManager.ts:183-230`) and uses **railway-based distance calculation** rather than straight-line distance. When unrealistic speeds are detected, a warning is logged and a red exclamation mark (!) indicator is displayed above the train.

**Why railway distance instead of straight-line distance?**

Trains follow rail paths, not straight lines. A train traveling from Barcelona to Girona follows the railway route (approximately 100km), not a straight line (approximately 75km). Using straight-line distance would:
- Allow unrealistic shortcuts through cities
- Miss cases where a train jumps to a different part of the same line
- Fail to detect position errors that are still along the railway corridor

**How the validation works:**

1. **Snap both positions to railways**: When a new position arrives, snap both the previous position and current position to their respective railway lines using `snapTrainToRailway()`. This gives us a `distance` value representing how far along the railway line each position is.

2. **Check if positions are on the same line**: If the train changed lines (e.g., at a transfer point), validation is skipped as this is expected behavior.

3. **Calculate distance traveled along the railway**: `distanceTraveled = |currentSnap.distance - previousSnap.distance|`

4. **Calculate speed**: `speed = distanceTraveled / timeDelta`

5. **Compare against maximum realistic speed**: The maximum is set to 300 km/h (~83 m/s), which is 50% higher than Rodalies trains' actual maximum of 140 km/h (~39 m/s). This buffer accounts for:
   - GPS timing inaccuracies
   - Brief high-speed sections
   - Network latency in position updates

6. **Log and mark**: If speed exceeds the maximum, a warning is logged with details about the calculated speed, and a red exclamation mark indicator is displayed above the train. The position update is still applied to avoid trains getting stuck with stale data.

### Key Takeaways

- Position validation uses **railway distance**, not straight-line distance, because trains follow rail paths
- Validation only applies when both positions snap to the **same railway line**
- Maximum speed is set to 300 km/h with a 50% safety buffer above realistic speeds
- Unrealistic speeds trigger a **warning log and visual indicator** (red exclamation mark above train)
- Position updates are **still applied** to prevent trains from getting stuck with stale data
- Warning indicators are **automatically removed** when subsequent updates have realistic speeds
- The validation happens in `updateTrainMeshes()` before updating the warning indicator state

### Code References

- Validation method: `apps/web/src/lib/trains/trainMeshManager.ts:183-230`
- Warning indicator creation: `apps/web/src/lib/trains/trainMeshManager.ts:235-263`
- Validation call and indicator update: `apps/web/src/lib/trains/trainMeshManager.ts:592-619`
- Railway snapping: `apps/web/src/lib/trains/trainMeshManager.ts:144-175`
- Distance calculation: `apps/web/src/lib/trains/geometry.ts:167-182` (internal `distanceBetween`)

### Example

```typescript
// Bad GPS data: train appears to jump 50km in 30 seconds
// Previous: 25.5km along R2 line
// Current: 75.5km along R2 line
// Time: 30 seconds
// Speed: 50,000m / 30s = 1,666 m/s = 6,000 km/h ❌

// Console output:
// "TrainMeshManager: Unrealistic speed detected for train 12345"
// {
//   lineId: "R2",
//   distanceTraveled: "50000m",
//   timeDelta: "30.0s",
//   calculatedSpeed: "1666.7 m/s (6000 km/h)",
//   maxAllowed: "83.3 m/s (300 km/h)"
// }

// Result:
// - Train moves to new position (75.5km) to avoid getting stuck
// - Red exclamation mark (!) appears above the train
// - Warning indicator removed when next update has realistic speed
```

---
