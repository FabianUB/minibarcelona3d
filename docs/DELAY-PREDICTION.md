# Delay Display Strategy

**Decision Date**: 2025-11-01
**Last Updated**: 2025-11-01
**Context**: Implementation of expandable stop list feature (Tasks T077-T086)

## Problem Statement

The application has access to multiple sources of delay information:

1. **Current delay** from `rt_rodalies_vehicle_current` table
   - Fields: `arrival_delay_seconds`, `departure_delay_seconds`
   - Source: Vehicle position feed
   - Represents actual measured delay at the train's current/most recent stop

2. **Predicted delays per stop** from `rt_trip_delays` table
   - Joined with `dim_stop_times` in the `GetTripDetails` query
   - Source: Trip updates feed
   - Represents predicted delays for each stop along the route, including future stops

3. **Schedule-based delay calculation**
   - Compare scheduled time vs current time
   - Source: `dim_stop_times` (scheduled arrival/departure) vs `NOW()`
   - Represents objective delay based on the timetable

During implementation, we discovered inconsistencies where different views showed different delay information, and also situations where trains showed "on time" despite having passed their scheduled times without reaching stations.

## Decision: Use Schedule-Based Delay Calculation

We chose to **calculate delays based on the official schedule** rather than relying solely on real-time feed data for the following reasons:

### Rationale

1. **Schedule is the source of truth**
   - If a train is scheduled to arrive at 23:16 and hasn't arrived by 23:26, it is objectively 10 minutes late
   - This is independent of what the vehicle position feed reports
   - The schedule represents the contract with passengers

2. **Handles data inconsistencies**
   - Vehicle position feeds can be stale, missing, or incorrect
   - Real-time prediction feeds often have null values
   - Schedule-based calculation always works if we have the timetable

3. **User expectations**
   - Passengers plan their journeys based on the published schedule
   - Delay should be measured against what was promised, not against real-time estimates
   - "The train was supposed to be here 10 minutes ago" is what matters to users

4. **Consistency across all stops**
   - Can calculate delay for any stop (past, current, or future)
   - No dependency on real-time feeds that may have gaps
   - Same calculation logic applies throughout the journey

5. **Handles edge cases**
   - Trains showing "on time" despite being past scheduled times
   - Stops that are overdue but not yet reached
   - Situations where real-time data contradicts observable reality

### Implementation

**Delay Calculation Logic:**

For each stop, calculate delay as:
```typescript
const now = new Date();
const scheduledTime = parseScheduledTime(stop.scheduledArrival || stop.scheduledDeparture);

if (status === 'completed') {
  // For past stops: use actual delay from rt_trip_delays if available
  // Falls back to schedule-based calculation if real-time data is missing
  delay = stop.arrivalDelaySeconds || calculateDelayFromSchedule(scheduledTime, now);
} else if (status === 'current') {
  // For current stop: calculate based on schedule vs current time
  delay = calculateDelayFromSchedule(scheduledTime, now);
} else {
  // For future stops: compare scheduled time vs current time
  // If scheduled time has passed, show as delayed
  // If scheduled time is in the future, show as scheduled (no delay badge)
  if (scheduledTime < now) {
    delay = calculateDelayFromSchedule(scheduledTime, now);
  } else {
    delay = null; // Not yet late
  }
}
```

**Compact View (TrainInfoPanel):**
- Shows overall train delay
- **Primary**: Calculate delay from trip schedule (current stop's scheduled time vs current time)
- Fetches trip details when panel opens to get accurate schedule data
- Displays as: "On time", "X min late", or "X min early"
- Shows "Unknown" if trip details unavailable

**Expanded View (StopList component):**
- Shows scheduled arrival/departure times for all stops
- Shows calculated delays based on schedule vs current time
- Visual indicators:
  - **Completed stops**: Gray background, show actual delay if available from real-time feed
  - **Current stop**: Highlighted, show delay calculated from schedule vs now
  - **Upcoming stops**:
    - If scheduled time has passed: Show delay with red badge
    - If scheduled time is in future: Show scheduled time only (no delay)
  - **Overdue stops**: Stops where train hasn't arrived but scheduled time has passed - shown with delay calculation

### What We Show

- **Schedule-based delays**: Calculated by comparing scheduled time vs current time
- **Actual delays for completed stops**: From `rt_trip_delays` when available
- **Overdue indicators**: For stops where scheduled time has passed but train hasn't arrived

### What We Don't Show

We explicitly **do not** show:
- Future predictions from `rt_trip_delays` for stops that aren't overdue yet
- Estimated arrival times based on extrapolation
- Complex ETA calculations with average speed/distance

We prefer schedule-based calculation (objective and always available) over predictions (subjective and often missing).

## Alternatives Considered

### Option 1: Vehicle Position Feed Only
Use only `arrival_delay_seconds` from `rt_rodalies_vehicle_current`.

**Rejected because:**
- Doesn't account for stops that are overdue but not yet reached
- Shows "on time" when train is past scheduled time but position feed hasn't updated
- Inconsistent with user expectations based on published schedule

### Option 2: Predicted Delays Only
Use only `rt_trip_delays` for all stops.

**Rejected because:**
- Data availability is inconsistent (many null values)
- Predictions can be unreliable or change frequently
- Adds complexity without clear benefit over schedule-based calculation

### Option 3: Hybrid (Selected)
Use schedule-based calculation as primary method, augmented with real-time data when available.

**Selected because:**
- Always works (schedule is always available)
- Matches user expectations (delays measured against published timetable)
- Can use real-time data to improve accuracy when available
- Handles edge cases properly

## Database Schema Reference

### Current Delay (What We Use)

```sql
SELECT arrival_delay_seconds, departure_delay_seconds
FROM rt_rodalies_vehicle_current
WHERE vehicle_key = ?
```

### Predicted Delays (What We Don't Use)

```sql
SELECT td.arrival_delay_seconds, td.departure_delay_seconds
FROM rt_trip_delays td
WHERE td.trip_id = ? AND td.stop_id = ?
```

## Code References

- Schedule calculation (compact view): `apps/web/src/features/trains/TrainInfoPanelMobile.tsx:83-122` (`calculateScheduleDelay`)
- Schedule calculation (compact view): `apps/web/src/features/trains/TrainInfoPanelDesktop.tsx:87-126` (`calculateScheduleDelay`)
- Schedule calculation (expanded view): `apps/web/src/features/trains/StopList.tsx:83-99` (`calculateScheduleDelay`)
- Trip details fetching: Both panels fetch on mount via `fetchTripDetails()` API call
- Backend query: `apps/api/repository/postgres.go:386` (`GetTripDetails`)

## Future Considerations

If we decide to add predicted delays in the future, we should:

1. **Clearly label them as predictions**
   - "Predicted: +11 min" vs "Current: On time"
   - Use different visual styling

2. **Show confidence/freshness**
   - When was the prediction made?
   - How reliable is it?

3. **Provide toggle option**
   - Let users choose between current delay only vs predictions
   - Default to current delay

4. **Test data quality first**
   - Analyze `rt_trip_delays` data coverage and accuracy
   - Compare predictions to actual arrivals
   - Only show if prediction quality is high enough

## Related Tasks

- T077-T084: StopList component implementation
- T085-T086: Integration into TrainInfoPanel
- Phase 6: User Story 3 - View Stop Details and Status

## See Also

- `/docs/DATABASE_SCHEMA.md` - Full schema documentation
- `/specs/002-realtime-train-tracking/spec.md` - Feature specification
