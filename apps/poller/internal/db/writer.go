package db

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// CreateSnapshot creates a new snapshot record and returns its ID
func (db *DB) CreateSnapshot(ctx context.Context, polledAt time.Time) (string, error) {
	snapshotID := uuid.New().String()
	polledAtStr := polledAt.UTC().Format(time.RFC3339)

	_, err := db.conn.ExecContext(ctx,
		"INSERT INTO rt_snapshots (snapshot_id, polled_at_utc) VALUES (?, ?)",
		snapshotID, polledAtStr,
	)
	if err != nil {
		return "", fmt.Errorf("failed to create snapshot: %w", err)
	}

	return snapshotID, nil
}

// RodaliesPosition represents a Rodalies train position for database insertion
type RodaliesPosition struct {
	VehicleKey           string
	VehicleID            *string
	EntityID             string
	VehicleLabel         string
	TripID               *string
	RouteID              *string
	CurrentStopID        *string
	PreviousStopID       *string
	NextStopID           *string
	NextStopSequence     *int
	Status               string
	Latitude             *float64
	Longitude            *float64
	VehicleTimestamp     *time.Time
	ArrivalDelaySeconds  *int
	DepartureDelaySeconds *int
	ScheduleRelationship *string
	PredictedArrival     *time.Time
	PredictedDeparture   *time.Time
	TripUpdateTimestamp  *time.Time
}

// UpsertRodaliesPositions inserts or updates Rodalies positions
func (db *DB) UpsertRodaliesPositions(ctx context.Context, snapshotID string, polledAt time.Time, positions []RodaliesPosition) error {
	tx, err := db.conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	polledAtStr := polledAt.UTC().Format(time.RFC3339)

	// Prepare upsert statement for current table
	currentStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO rt_rodalies_vehicle_current (
			vehicle_key, snapshot_id, vehicle_id, entity_id, vehicle_label,
			trip_id, route_id, current_stop_id, previous_stop_id, next_stop_id,
			next_stop_sequence, status, latitude, longitude, vehicle_timestamp_utc,
			polled_at_utc, arrival_delay_seconds, departure_delay_seconds,
			schedule_relationship, predicted_arrival_utc, predicted_departure_utc,
			trip_update_timestamp_utc, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
		ON CONFLICT (vehicle_key) DO UPDATE SET
			snapshot_id = excluded.snapshot_id,
			vehicle_id = excluded.vehicle_id,
			entity_id = excluded.entity_id,
			vehicle_label = excluded.vehicle_label,
			trip_id = excluded.trip_id,
			route_id = excluded.route_id,
			current_stop_id = excluded.current_stop_id,
			previous_stop_id = excluded.previous_stop_id,
			next_stop_id = excluded.next_stop_id,
			next_stop_sequence = excluded.next_stop_sequence,
			status = excluded.status,
			latitude = excluded.latitude,
			longitude = excluded.longitude,
			vehicle_timestamp_utc = excluded.vehicle_timestamp_utc,
			polled_at_utc = excluded.polled_at_utc,
			arrival_delay_seconds = excluded.arrival_delay_seconds,
			departure_delay_seconds = excluded.departure_delay_seconds,
			schedule_relationship = excluded.schedule_relationship,
			predicted_arrival_utc = excluded.predicted_arrival_utc,
			predicted_departure_utc = excluded.predicted_departure_utc,
			trip_update_timestamp_utc = excluded.trip_update_timestamp_utc,
			updated_at = datetime('now')
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare current statement: %w", err)
	}
	defer currentStmt.Close()

	// Prepare insert statement for history table
	historyStmt, err := tx.PrepareContext(ctx, `
		INSERT OR IGNORE INTO rt_rodalies_vehicle_history (
			vehicle_key, snapshot_id, vehicle_id, entity_id, vehicle_label,
			trip_id, route_id, current_stop_id, previous_stop_id, next_stop_id,
			next_stop_sequence, status, latitude, longitude, vehicle_timestamp_utc,
			polled_at_utc, arrival_delay_seconds, departure_delay_seconds,
			schedule_relationship, predicted_arrival_utc, predicted_departure_utc,
			trip_update_timestamp_utc
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare history statement: %w", err)
	}
	defer historyStmt.Close()

	for _, p := range positions {
		var vehicleTS, predArr, predDep, tripUpTS *string
		if p.VehicleTimestamp != nil {
			s := p.VehicleTimestamp.UTC().Format(time.RFC3339)
			vehicleTS = &s
		}
		if p.PredictedArrival != nil {
			s := p.PredictedArrival.UTC().Format(time.RFC3339)
			predArr = &s
		}
		if p.PredictedDeparture != nil {
			s := p.PredictedDeparture.UTC().Format(time.RFC3339)
			predDep = &s
		}
		if p.TripUpdateTimestamp != nil {
			s := p.TripUpdateTimestamp.UTC().Format(time.RFC3339)
			tripUpTS = &s
		}

		args := []interface{}{
			p.VehicleKey, snapshotID, p.VehicleID, p.EntityID, p.VehicleLabel,
			p.TripID, p.RouteID, p.CurrentStopID, p.PreviousStopID, p.NextStopID,
			p.NextStopSequence, p.Status, p.Latitude, p.Longitude, vehicleTS,
			polledAtStr, p.ArrivalDelaySeconds, p.DepartureDelaySeconds,
			p.ScheduleRelationship, predArr, predDep, tripUpTS,
		}

		if _, err := currentStmt.ExecContext(ctx, args...); err != nil {
			return fmt.Errorf("failed to upsert position %s: %w", p.VehicleKey, err)
		}

		if _, err := historyStmt.ExecContext(ctx, args...); err != nil {
			return fmt.Errorf("failed to insert history %s: %w", p.VehicleKey, err)
		}
	}

	return tx.Commit()
}

// MetroPosition represents a Metro train position for database insertion
type MetroPosition struct {
	VehicleKey           string
	LineCode             string
	RouteID              *string
	DirectionID          int
	Latitude             float64
	Longitude            float64
	Bearing              *float64
	PreviousStopID       *string
	NextStopID           *string
	PreviousStopName     *string
	NextStopName         *string
	Status               string
	ProgressFraction     *float64
	DistanceAlongLine    *float64
	EstimatedSpeedMPS    *float64
	LineTotalLength      *float64
	Source               string
	Confidence           string
	ArrivalSecondsToNext *int
	EstimatedAt          time.Time
}

// UpsertMetroPositions inserts or updates Metro positions
func (db *DB) UpsertMetroPositions(ctx context.Context, snapshotID string, polledAt time.Time, positions []MetroPosition) error {
	tx, err := db.conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	polledAtStr := polledAt.UTC().Format(time.RFC3339)

	// Prepare upsert statement for current table
	currentStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO rt_metro_vehicle_current (
			vehicle_key, snapshot_id, line_code, route_id, direction_id,
			latitude, longitude, bearing, previous_stop_id, next_stop_id,
			previous_stop_name, next_stop_name, status, progress_fraction,
			distance_along_line, estimated_speed_mps, line_total_length,
			source, confidence, arrival_seconds_to_next, estimated_at_utc,
			polled_at_utc, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
		ON CONFLICT (vehicle_key) DO UPDATE SET
			snapshot_id = excluded.snapshot_id,
			line_code = excluded.line_code,
			route_id = excluded.route_id,
			direction_id = excluded.direction_id,
			latitude = excluded.latitude,
			longitude = excluded.longitude,
			bearing = excluded.bearing,
			previous_stop_id = excluded.previous_stop_id,
			next_stop_id = excluded.next_stop_id,
			previous_stop_name = excluded.previous_stop_name,
			next_stop_name = excluded.next_stop_name,
			status = excluded.status,
			progress_fraction = excluded.progress_fraction,
			distance_along_line = excluded.distance_along_line,
			estimated_speed_mps = excluded.estimated_speed_mps,
			line_total_length = excluded.line_total_length,
			source = excluded.source,
			confidence = excluded.confidence,
			arrival_seconds_to_next = excluded.arrival_seconds_to_next,
			estimated_at_utc = excluded.estimated_at_utc,
			polled_at_utc = excluded.polled_at_utc,
			updated_at = datetime('now')
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare current statement: %w", err)
	}
	defer currentStmt.Close()

	// Prepare insert statement for history table
	historyStmt, err := tx.PrepareContext(ctx, `
		INSERT OR IGNORE INTO rt_metro_vehicle_history (
			vehicle_key, snapshot_id, line_code, direction_id,
			latitude, longitude, bearing, previous_stop_id, next_stop_id,
			status, progress_fraction, polled_at_utc
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare history statement: %w", err)
	}
	defer historyStmt.Close()

	for _, p := range positions {
		estimatedAtStr := p.EstimatedAt.UTC().Format(time.RFC3339)

		// Current table
		_, err := currentStmt.ExecContext(ctx,
			p.VehicleKey, snapshotID, p.LineCode, p.RouteID, p.DirectionID,
			p.Latitude, p.Longitude, p.Bearing, p.PreviousStopID, p.NextStopID,
			p.PreviousStopName, p.NextStopName, p.Status, p.ProgressFraction,
			p.DistanceAlongLine, p.EstimatedSpeedMPS, p.LineTotalLength,
			p.Source, p.Confidence, p.ArrivalSecondsToNext, estimatedAtStr,
			polledAtStr,
		)
		if err != nil {
			return fmt.Errorf("failed to upsert metro position %s: %w", p.VehicleKey, err)
		}

		// History table
		_, err = historyStmt.ExecContext(ctx,
			p.VehicleKey, snapshotID, p.LineCode, p.DirectionID,
			p.Latitude, p.Longitude, p.Bearing, p.PreviousStopID, p.NextStopID,
			p.Status, p.ProgressFraction, polledAtStr,
		)
		if err != nil {
			return fmt.Errorf("failed to insert metro history %s: %w", p.VehicleKey, err)
		}
	}

	return tx.Commit()
}

// VehicleStopState represents the last known stop state of a vehicle
type VehicleStopState struct {
	VehicleKey     string
	CurrentStopID  *string
	PreviousStopID *string
	NextStopID     *string
	Status         *string
}

// GetRodaliesVehicleStopStates returns the current stop state of all Rodalies vehicles
func (db *DB) GetRodaliesVehicleStopStates(ctx context.Context) (map[string]VehicleStopState, error) {
	rows, err := db.conn.QueryContext(ctx, `
		SELECT vehicle_key, current_stop_id, previous_stop_id, next_stop_id, status
		FROM rt_rodalies_vehicle_current
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to query vehicle states: %w", err)
	}
	defer rows.Close()

	states := make(map[string]VehicleStopState)
	for rows.Next() {
		var state VehicleStopState
		if err := rows.Scan(&state.VehicleKey, &state.CurrentStopID, &state.PreviousStopID, &state.NextStopID, &state.Status); err != nil {
			return nil, fmt.Errorf("failed to scan vehicle state: %w", err)
		}
		states[state.VehicleKey] = state
	}

	return states, rows.Err()
}

// AdjacentStops contains the previous and next stop IDs for a given stop in a trip
type AdjacentStops struct {
	PreviousStopID *string
	NextStopID     *string
	StopSequence   int
}

// GetAdjacentStops looks up the previous and next stops for a given trip and stop
// from the GTFS dimension tables
func (db *DB) GetAdjacentStops(ctx context.Context, tripID, stopID string) (*AdjacentStops, error) {
	// First, get the stop_sequence for the given stop
	var stopSeq int
	err := db.conn.QueryRowContext(ctx, `
		SELECT stop_sequence FROM dim_stop_times
		WHERE trip_id = ? AND stop_id = ?
	`, tripID, stopID).Scan(&stopSeq)
	if err != nil {
		return nil, err // Returns sql.ErrNoRows if not found
	}

	result := &AdjacentStops{StopSequence: stopSeq}

	// Get previous stop (stop_sequence - 1)
	var prevStopID string
	err = db.conn.QueryRowContext(ctx, `
		SELECT stop_id FROM dim_stop_times
		WHERE trip_id = ? AND stop_sequence = ?
	`, tripID, stopSeq-1).Scan(&prevStopID)
	if err == nil {
		result.PreviousStopID = &prevStopID
	}

	// Get next stop (stop_sequence + 1)
	var nextStopID string
	err = db.conn.QueryRowContext(ctx, `
		SELECT stop_id FROM dim_stop_times
		WHERE trip_id = ? AND stop_sequence = ?
	`, tripID, stopSeq+1).Scan(&nextStopID)
	if err == nil {
		result.NextStopID = &nextStopID
	}

	return result, nil
}

// GTFSStop represents a stop for dimension table insertion
type GTFSStop struct {
	StopID   string
	StopCode string
	StopName string
	StopLat  float64
	StopLon  float64
}

// GTFSTrip represents a trip for dimension table insertion
type GTFSTrip struct {
	TripID       string
	RouteID      string
	ServiceID    string
	TripHeadsign string
	DirectionID  int
}

// GTFSStopTime represents a stop time for dimension table insertion
type GTFSStopTime struct {
	TripID           string
	StopID           string
	StopSequence     int
	ArrivalSeconds   int
	DepartureSeconds int
}

// UpsertGTFSDimensionData populates GTFS dimension tables
func (db *DB) UpsertGTFSDimensionData(ctx context.Context, network string, stops []GTFSStop, trips []GTFSTrip, stopTimes []GTFSStopTime) error {
	tx, err := db.conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Clear existing data for this network
	if _, err := tx.ExecContext(ctx, "DELETE FROM dim_stop_times WHERE network = ?", network); err != nil {
		return fmt.Errorf("failed to clear stop_times: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM dim_trips WHERE network = ?", network); err != nil {
		return fmt.Errorf("failed to clear trips: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM dim_stops WHERE network = ?", network); err != nil {
		return fmt.Errorf("failed to clear stops: %w", err)
	}

	// Insert stops
	stopStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO dim_stops (stop_id, network, stop_code, stop_name, stop_lat, stop_lon)
		VALUES (?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare stops statement: %w", err)
	}
	defer stopStmt.Close()

	for _, s := range stops {
		if _, err := stopStmt.ExecContext(ctx, s.StopID, network, s.StopCode, s.StopName, s.StopLat, s.StopLon); err != nil {
			return fmt.Errorf("failed to insert stop %s: %w", s.StopID, err)
		}
	}

	// Insert trips
	tripStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO dim_trips (trip_id, network, route_id, service_id, trip_headsign, direction_id)
		VALUES (?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare trips statement: %w", err)
	}
	defer tripStmt.Close()

	for _, t := range trips {
		if _, err := tripStmt.ExecContext(ctx, t.TripID, network, t.RouteID, t.ServiceID, t.TripHeadsign, t.DirectionID); err != nil {
			return fmt.Errorf("failed to insert trip %s: %w", t.TripID, err)
		}
	}

	// Insert stop times
	stStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO dim_stop_times (network, trip_id, stop_id, stop_sequence, arrival_seconds, departure_seconds)
		VALUES (?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare stop_times statement: %w", err)
	}
	defer stStmt.Close()

	for _, st := range stopTimes {
		if _, err := stStmt.ExecContext(ctx, network, st.TripID, st.StopID, st.StopSequence, st.ArrivalSeconds, st.DepartureSeconds); err != nil {
			return fmt.Errorf("failed to insert stop_time for trip %s: %w", st.TripID, err)
		}
	}

	return tx.Commit()
}

// GTFSRoute represents a route for dimension table insertion
type GTFSRoute struct {
	RouteID        string
	RouteShortName string
	RouteLongName  string
	RouteType      int
	RouteColor     string
	RouteTextColor string
}

// GTFSCalendar represents a service calendar for dimension table insertion
type GTFSCalendar struct {
	ServiceID string
	Monday    bool
	Tuesday   bool
	Wednesday bool
	Thursday  bool
	Friday    bool
	Saturday  bool
	Sunday    bool
	StartDate string
	EndDate   string
}

// GTFSCalendarDate represents a service exception for dimension table insertion
type GTFSCalendarDate struct {
	ServiceID     string
	Date          string
	ExceptionType int
}

// UpsertGTFSRouteData populates the routes dimension table
func (db *DB) UpsertGTFSRouteData(ctx context.Context, network string, routes []GTFSRoute) error {
	tx, err := db.conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Clear existing data for this network
	if _, err := tx.ExecContext(ctx, "DELETE FROM dim_routes WHERE network = ?", network); err != nil {
		return fmt.Errorf("failed to clear routes: %w", err)
	}

	// Insert routes
	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO dim_routes (route_id, network, route_short_name, route_long_name, route_type, route_color, route_text_color)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare routes statement: %w", err)
	}
	defer stmt.Close()

	for _, r := range routes {
		if _, err := stmt.ExecContext(ctx, r.RouteID, network, r.RouteShortName, r.RouteLongName, r.RouteType, r.RouteColor, r.RouteTextColor); err != nil {
			return fmt.Errorf("failed to insert route %s: %w", r.RouteID, err)
		}
	}

	return tx.Commit()
}

// UpsertGTFSCalendarData populates the calendar dimension tables
func (db *DB) UpsertGTFSCalendarData(ctx context.Context, network string, calendars []GTFSCalendar, calendarDates []GTFSCalendarDate) error {
	tx, err := db.conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Clear existing data for this network
	if _, err := tx.ExecContext(ctx, "DELETE FROM dim_calendar_dates WHERE network = ?", network); err != nil {
		return fmt.Errorf("failed to clear calendar_dates: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM dim_calendar WHERE network = ?", network); err != nil {
		return fmt.Errorf("failed to clear calendar: %w", err)
	}

	// Insert calendars
	calStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO dim_calendar (service_id, network, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare calendar statement: %w", err)
	}
	defer calStmt.Close()

	for _, c := range calendars {
		if _, err := calStmt.ExecContext(ctx, c.ServiceID, network,
			boolToInt(c.Monday), boolToInt(c.Tuesday), boolToInt(c.Wednesday),
			boolToInt(c.Thursday), boolToInt(c.Friday), boolToInt(c.Saturday), boolToInt(c.Sunday),
			c.StartDate, c.EndDate); err != nil {
			return fmt.Errorf("failed to insert calendar %s: %w", c.ServiceID, err)
		}
	}

	// Insert calendar dates
	cdStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO dim_calendar_dates (network, service_id, date, exception_type)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare calendar_dates statement: %w", err)
	}
	defer cdStmt.Close()

	for _, cd := range calendarDates {
		if _, err := cdStmt.ExecContext(ctx, network, cd.ServiceID, cd.Date, cd.ExceptionType); err != nil {
			return fmt.Errorf("failed to insert calendar_date %s/%s: %w", cd.ServiceID, cd.Date, err)
		}
	}

	return tx.Commit()
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// SchedulePosition represents a schedule-estimated position for database insertion
type SchedulePosition struct {
	VehicleKey         string
	NetworkType        string
	RouteID            string
	RouteShortName     string
	RouteColor         string
	TripID             string
	DirectionID        int
	Latitude           float64
	Longitude          float64
	Bearing            *float64
	PreviousStopID     *string
	NextStopID         *string
	PreviousStopName   *string
	NextStopName       *string
	Status             string
	ProgressFraction   float64
	ScheduledArrival   *string
	ScheduledDeparture *string
	Source             string
	Confidence         string
	EstimatedAt        time.Time
}

// UpsertSchedulePositions inserts or updates schedule-estimated positions
func (db *DB) UpsertSchedulePositions(ctx context.Context, snapshotID string, polledAt time.Time, positions []SchedulePosition) error {
	tx, err := db.conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	polledAtStr := polledAt.UTC().Format(time.RFC3339)

	// Prepare upsert statement
	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO rt_schedule_vehicle_current (
			vehicle_key, snapshot_id, network_type, route_id, route_short_name,
			route_color, trip_id, direction_id, latitude, longitude,
			bearing, previous_stop_id, next_stop_id, previous_stop_name, next_stop_name,
			status, progress_fraction, scheduled_arrival, scheduled_departure,
			source, confidence, estimated_at_utc, polled_at_utc, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
		ON CONFLICT (vehicle_key) DO UPDATE SET
			snapshot_id = excluded.snapshot_id,
			network_type = excluded.network_type,
			route_id = excluded.route_id,
			route_short_name = excluded.route_short_name,
			route_color = excluded.route_color,
			trip_id = excluded.trip_id,
			direction_id = excluded.direction_id,
			latitude = excluded.latitude,
			longitude = excluded.longitude,
			bearing = excluded.bearing,
			previous_stop_id = excluded.previous_stop_id,
			next_stop_id = excluded.next_stop_id,
			previous_stop_name = excluded.previous_stop_name,
			next_stop_name = excluded.next_stop_name,
			status = excluded.status,
			progress_fraction = excluded.progress_fraction,
			scheduled_arrival = excluded.scheduled_arrival,
			scheduled_departure = excluded.scheduled_departure,
			source = excluded.source,
			confidence = excluded.confidence,
			estimated_at_utc = excluded.estimated_at_utc,
			polled_at_utc = excluded.polled_at_utc,
			updated_at = datetime('now')
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	for _, p := range positions {
		estimatedAtStr := p.EstimatedAt.UTC().Format(time.RFC3339)

		_, err := stmt.ExecContext(ctx,
			p.VehicleKey, snapshotID, p.NetworkType, p.RouteID, p.RouteShortName,
			p.RouteColor, p.TripID, p.DirectionID, p.Latitude, p.Longitude,
			p.Bearing, p.PreviousStopID, p.NextStopID, p.PreviousStopName, p.NextStopName,
			p.Status, p.ProgressFraction, p.ScheduledArrival, p.ScheduledDeparture,
			p.Source, p.Confidence, estimatedAtStr, polledAtStr,
		)
		if err != nil {
			return fmt.Errorf("failed to upsert schedule position %s: %w", p.VehicleKey, err)
		}
	}

	return tx.Commit()
}
