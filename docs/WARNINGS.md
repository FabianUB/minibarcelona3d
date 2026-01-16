# Future Considerations & Potential Issues

This document tracks known limitations, potential issues, and design decisions that may need revisiting in the future.

## API Caching

### Trip Details Endpoint Cache (`GET /api/trips/{tripId}`)

**Current Implementation**: 15-second cache with 10-second stale-while-revalidate

**Location**: `apps/api/handlers/trains.go:GetTripDetails()`

**Purpose**: The trip details endpoint provides real-time delay calculations used in the TrainInfoPanel to show:
- Predicted arrival/departure times
- Delay in seconds (arrival and departure)
- Schedule relationship status

**Cache Configuration**:
```go
w.Header().Set("Cache-Control", "public, max-age=15, stale-while-revalidate=10")
```

**Why This May Need Changing**:

1. **Accuracy vs Performance Trade-off**:
   - 15-second cache means delay information can be up to 15 seconds stale
   - If trains are experiencing rapidly changing delays (e.g., moving from "on time" to "5 minutes late" within seconds), users may see outdated information
   - Real-time delay calculations could be affected if conditions change faster than cache refresh

2. **Stale-While-Revalidate Risk**:
   - The `stale-while-revalidate=10` allows serving data up to 25 seconds old (15s + 10s) in edge cases
   - This could show significantly outdated delay predictions during service disruptions

3. **When to Consider Removing Cache**:
   - If users report seeing incorrect or "jumpy" delay information
   - If delays are changing more frequently than every 15 seconds during peak times
   - If real-time accuracy becomes more critical than API performance

**Alternative Approaches**:

1. **Remove cache entirely**:
   ```go
   w.Header().Set("Cache-Control", "no-cache, must-revalidate")
   ```
   - Pros: Always fresh data, most accurate delay calculations
   - Cons: Increased database load, slower response times

2. **Reduce cache duration to 5 seconds**:
   ```go
   w.Header().Set("Cache-Control", "public, max-age=5, stale-while-revalidate=3")
   ```
   - Pros: Better balance between freshness and performance
   - Cons: Still some staleness, more database queries

3. **Use WebSocket/SSE for real-time updates**:
   - Push delay updates to clients as they happen
   - Pros: True real-time updates, no polling overhead
   - Cons: More complex infrastructure, requires significant refactoring

**How to Monitor**:
- Watch for user complaints about "incorrect" delay information
- Monitor API response times for the trips endpoint
- Compare database delay values with what's shown in the UI
- Check if delays are changing faster than the cache duration

**Related Files**:
- `apps/api/handlers/trains.go` - Cache headers
- `apps/web/src/features/trains/TrainInfoPanelDesktop.tsx` - Consumes trip details
- `apps/web/src/features/trains/TrainInfoPanelMobile.tsx` - Consumes trip details
- `apps/web/src/lib/api/trains.ts` - API client

**Decision History**:
- Initially implemented with 5-minute cache (T102)
- Reduced to 15 seconds after realizing delay data changes frequently
- May need further adjustment based on production usage patterns

---

## E2E Test Limitations

### Train Filtering Tests Require Test IDs

**Current Status**: 24 tests in `train-filtering.spec.ts` are failing

**Issue**: Tests expect `data-testid="rodalies-legend"` on the legend component, but it doesn't exist yet.

**Required Changes**:
- Add `data-testid="rodalies-legend"` to the RodaLegend component
- Add `data-line-id` attributes to individual line items
- Add `data-testid="isolate-toggle"` to the isolate mode toggle button

**Files to Update**:
- `apps/web/src/features/legend/RodaLegend.tsx` (or wherever legend is implemented)

**Why This Matters**:
- Tests are well-structured and will provide good coverage once IDs are added
- Without these tests, line filtering functionality is not properly validated
- Users may experience bugs in filtering that go undetected

---

## Three.js Performance

### Performance Monitoring Thresholds

**Current Thresholds**:
- FPS warning: < 30 FPS
- Frame time warning: > 33.33ms

**Location**: `apps/web/src/features/trains/TrainLayer3D.tsx`

**Potential Issues**:

1. **Mobile Devices**: These thresholds may be too strict for mobile devices with less powerful GPUs
2. **High Train Count**: During peak hours with 150+ trains, performance may degrade
3. **WebGL Context Loss**: No recovery mechanism if WebGL context is lost

**Future Considerations**:
- Implement adaptive quality (reduce mesh detail on lower-end devices)
- Add LOD (Level of Detail) system for distant trains
- Implement train culling for trains far outside viewport
- Add WebGL context loss recovery

---

## Railway Line Snapping

### Snapping Accuracy Limitations

**Current Implementation**: Trains are snapped to the nearest point on their route line

**Location**: `apps/web/src/lib/trains/geometry.ts`

**Known Limitations**:

1. **Branch Lines**: If a route has branches, snapping may choose the wrong branch
2. **Station Proximity**: Snapping near stations may be less accurate due to complex track layouts
3. **GPS Noise**: Rapid GPS fluctuations can cause jittery movement even with snapping

**When to Revisit**:
- If users report trains "jumping" between tracks
- If trains appear on wrong branch lines
- If snapping performance becomes a bottleneck

**Potential Improvements**:
- Use `nextStopId` to determine which branch to snap to
- Implement Kalman filtering for GPS positions
- Cache preprocessed railway lines more aggressively

---

## Stale Data Detection

### 60-Second Threshold

**Current Implementation**: Data older than 60 seconds is considered "stale" and trains are dimmed

**Location**: `apps/web/src/features/trains/TrainLayer3D.tsx`

**Rationale**:
- Trains update every 30 seconds
- If 2 consecutive updates fail, data is 60+ seconds old
- Visual indicator (50% opacity reduction) alerts users

**Potential Issues**:

1. **False Positives**: Network hiccups could trigger stale warnings unnecessarily
2. **User Confusion**: Users may not understand why trains suddenly dim
3. **Threshold Too Strict**: During low service hours, updates may be less frequent

**Future Considerations**:
- Add user-facing notification: "Train data may be outdated"
- Increase threshold to 90 seconds (3 missed updates)
- Make threshold configurable via environment variable

---

## Database Considerations

### SQLite in Production

**Current Implementation**: SQLite with WAL mode enabled

**Location**: `apps/api/repository/sqlite.go`

**Why SQLite Works for This Project**:

1. **Single Writer**: Only one poller service writes to the database
2. **Moderate Read Load**: Frontend polls every 30 seconds, not hundreds of concurrent users
3. **Simple Deployment**: No separate database server required
4. **File-Based**: Easy to backup and restore

**When to Consider PostgreSQL**:

- If multiple poller instances need to write concurrently
- If read load exceeds SQLite's capabilities (~100k requests/day)
- If you need advanced features (JSONB, full-text search, etc.)

**Current Performance**:
- Read queries typically <10ms
- WAL mode allows concurrent reads during writes
- Database file size grows linearly with data (~50MB typical)

---

## Error Handling

### Exponential Backoff May Be Too Aggressive

**Current Implementation**: Retry delays of 2s, 4s, 8s, 16s, 32s (max 5 retries)

**Location**: `apps/web/src/features/trains/TrainLayer3D.tsx`

**Potential Issues**:

1. **Long Recovery Time**: After 5 failed attempts, it takes 62 seconds before giving up
2. **Server Overload**: Many clients retrying simultaneously could cause thundering herd problem
3. **User Experience**: Users wait over a minute before seeing "unable to load trains" error

**Alternative Approaches**:
- Add jitter to retry delays (randomize timing to prevent thundering herd)
- Reduce max delay to 16 seconds instead of 32 seconds
- Show error message earlier (after 3 failures instead of 5)
- Implement circuit breaker pattern (stop retrying after repeated failures)

---

## Train Info Panel Loading States

### Trip Details Fetch Timeout

**Current Implementation**: No timeout on trip details fetch

**Location**:
- `apps/web/src/features/trains/TrainInfoPanelDesktop.tsx`
- `apps/web/src/features/trains/TrainInfoPanelMobile.tsx`

**Risk**: If the API is slow or unresponsive, loading spinner may spin indefinitely

**Recommended Fix**:
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

try {
  const details = await fetchTripDetails(selectedTrain.tripId, {
    signal: controller.signal
  });
  setTripDetails(details);
} catch (err) {
  if (err.name === 'AbortError') {
    console.error('Trip details fetch timed out');
  }
} finally {
  clearTimeout(timeoutId);
  setIsTripDetailsLoading(false);
}
```

---

## Notes

This document should be reviewed and updated:
- When implementing new features that interact with these systems
- When users report issues related to these areas
- When performance monitoring reveals problems
- During regular code maintenance cycles (quarterly recommended)

**Last Updated**: 2025-01-09
