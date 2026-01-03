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
