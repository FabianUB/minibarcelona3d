# API Documentation

This document explains key implementation decisions and behaviors of the mini-rodalies-3d API.

## Train Data Filtering: 10-Minute Freshness Window

### Implementation

All train endpoints (`/api/trains`, `/api/trains/positions`, `/api/trains?route_id=X`) only return trains that have been updated within the **last 10 minutes**.

**SQL Filter Applied:**
```sql
WHERE updated_at > NOW() - INTERVAL '10 minutes'
```

### Why This Was Necessary

#### The Problem

The `rt_rodalies_vehicle_current` table contains **all trains that have transmitted GTFS-RT data**, including:
- **Active trains**: Currently running and transmitting every 30 seconds
- **Completed trains**: Finished their routes hours ago, no longer transmitting

**Without filtering**, the API would return mostly stale data:
- Database total: 142 trains
- Fresh trains (<2min): 33 trains (23%)
- **Stale trains (>5min): 102 trains (72%)**

#### Analysis That Led to This Decision

We analyzed the correlation between data age and train state:

| Age Category | Total | NULL GPS | Status Distribution |
|--------------|-------|----------|---------------------|
| Fresh (<2min) | 33 | 2 | Actively transmitting |
| Recent (2-5min) | 7 | 1 | Possibly active |
| Stale (>5min) | 102 | 3 | Completed routes |

**Key Findings:**
1. **NULL GPS ≠ Completed route**: Only 3/102 stale trains had NULL coordinates
2. **Status field unreliable**: 25 stale trains still showed `INCOMING_AT` status
3. **Time is the only reliable indicator**: Trains stop transmitting when routes complete

#### Why 10 Minutes?

- GTFS-RT feed polls every **30 seconds**
- After **3-4 missed polls** (~2 minutes), a train is likely finished
- **10 minutes provides buffer** for:
  - Temporary network issues
  - Trains at end-of-line terminals (may pause before returning)
  - Feed inconsistencies

**Conservative but effective**: Captures all active trains while filtering completed routes.

### Alternative Approaches Considered

#### Option A: Use NULL GPS coordinates
**Rejected**: Only 3% of completed trains had NULL GPS. Most keep last-known position.

#### Option B: Use train status (`STOPPED_AT`)
**Rejected**: Many completed trains showed `INCOMING_AT` or `IN_TRANSIT_TO` status.

#### Option C: Database cleanup job
**Considered but unnecessary**: Time-based filtering is simpler and more reliable than trying to detect completion status.

#### Option D: Client-side filtering
**Rejected**: Wastes bandwidth returning 72% stale data. Server-side filtering is more efficient.

### Impact on API Behavior

**Before:**
```json
GET /api/trains
{
  "count": 142,
  "trains": [...142 trains, 72% stale...]
}
```

**After:**
```json
GET /api/trains
{
  "count": 40,
  "trains": [...40 active trains...]
}
```

### Affected Endpoints

All train retrieval methods apply this filter:

- `GET /api/trains` → `repository.GetAllTrains()`
- `GET /api/trains/positions` → `repository.GetAllTrainPositions()`
- `GET /api/trains?route_id=R1` → `repository.GetTrainsByRoute()`
- `GET /api/trains/{vehicleKey}` → `repository.GetTrainByKey()` (no filter - specific lookup)

### Timestamps in Response

Each train object includes multiple timestamps to track data freshness:

```json
{
  "vehicleKey": "25724",
  "vehicleLabel": "R1-25724",
  "polledAtUtc": "2025-10-26T12:10:05Z",  // When GTFS-RT data was polled
  "updatedAt": "2025-10-26T12:10:05Z",     // When database row was updated
  // ... other fields
}
```

**Response-level timestamp:**
```json
{
  "count": 40,
  "polledAt": "2025-10-26T12:10:17Z",  // When API responded
  "trains": [...]
}
```

The `polledAt` field represents **when the API responded**, not when data was collected. Individual train objects contain the actual data timestamps.

### Database Schema Reference

See `/docs/DATABASE_SCHEMA.md` for the complete `rt_rodalies_vehicle_current` table schema.

**Relevant columns:**
- `updated_at`: Database row update time (used for filtering)
- `polled_at_utc`: GTFS-RT feed poll timestamp (data collection time)
- `vehicle_timestamp_utc`: Timestamp from vehicle's GPS device

### Performance Considerations

**Benefits of filtering:**
- Reduces result set from ~142 to ~40 trains (71% reduction)
- Faster JSON serialization and network transfer
- Improved frontend rendering performance
- Query remains fast (<100ms) despite added WHERE clause (indexed column)

**Index requirement:**
```sql
CREATE INDEX idx_updated_at ON rt_rodalies_vehicle_current(updated_at);
```

### Future Enhancements

Possible improvements if needed:

1. **Configurable time window**: Accept query parameter `?max_age=300` (seconds)
2. **Historical endpoint**: Separate endpoint for completed trains `/api/trains/historical`
3. **Explicit active flag**: Add `is_active` boolean in database based on transmission freshness

### Related Documentation

- API Contract: `/specs/002-realtime-train-tracking/contracts/api.yaml`
- Data Model: `/specs/002-realtime-train-tracking/data-model.md`
- Database Schema: `/docs/DATABASE_SCHEMA.md`
- Implementation: `apps/api/repository/sqlite.go`
