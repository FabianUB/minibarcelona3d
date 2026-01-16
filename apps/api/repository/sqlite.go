package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/you/myapp/apps/api/models"

	_ "modernc.org/sqlite"
)

// SQLiteDB wraps a SQL database connection for SQLite
type SQLiteDB struct {
	db *sql.DB
}

// NewSQLiteDB creates a new SQLite database connection
func NewSQLiteDB(dbPath string) (*SQLiteDB, error) {
	db, err := sql.Open("sqlite", dbPath+"?_journal=WAL&_fk=1&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Configure connection pool
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(time.Hour)

	// Test connection
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &SQLiteDB{db: db}, nil
}

// Close closes the database connection
func (s *SQLiteDB) Close() error {
	return s.db.Close()
}

// GetDB returns the underlying database connection
func (s *SQLiteDB) GetDB() *sql.DB {
	return s.db
}

// SQLiteTrainRepository handles database operations for Rodalies trains using SQLite
type SQLiteTrainRepository struct {
	db *sql.DB
}

// NewSQLiteTrainRepository creates a new SQLiteTrainRepository
func NewSQLiteTrainRepository(db *sql.DB) *SQLiteTrainRepository {
	return &SQLiteTrainRepository{db: db}
}

// parseTimeString converts an RFC3339 string to *time.Time
// Returns nil if the input is nil or empty
func parseTimeString(s *string) *time.Time {
	if s == nil || *s == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, *s)
	if err != nil {
		return nil
	}
	return &t
}

// GetAllTrains returns all current Rodalies train positions
func (r *SQLiteTrainRepository) GetAllTrains(ctx context.Context) ([]models.Train, error) {
	query := `
		SELECT
			vehicle_key,
			vehicle_id,
			vehicle_label,
			entity_id,
			trip_id,
			route_id,
			latitude,
			longitude,
			current_stop_id,
			previous_stop_id,
			next_stop_id,
			next_stop_sequence,
			status,
			arrival_delay_seconds,
			departure_delay_seconds,
			schedule_relationship,
			predicted_arrival_utc,
			predicted_departure_utc,
			vehicle_timestamp_utc,
			polled_at_utc,
			updated_at,
			snapshot_id,
			trip_update_timestamp_utc
		FROM rt_rodalies_vehicle_current
		WHERE datetime(updated_at) > datetime('now', '-10 minutes')
		ORDER BY vehicle_key
	`

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query trains: %w", err)
	}
	defer rows.Close()

	var trains []models.Train
	for rows.Next() {
		var t models.Train
		// Use string pointers for timestamp fields (SQLite stores as RFC3339 strings)
		var predArrStr, predDepStr, vehTsStr, polledAtStr, updatedAtStr, snapshotIDStr, tripUpTsStr *string
		err := rows.Scan(
			&t.VehicleKey,
			&t.VehicleID,
			&t.VehicleLabel,
			&t.EntityID,
			&t.TripID,
			&t.RouteID,
			&t.Latitude,
			&t.Longitude,
			&t.CurrentStopID,
			&t.PreviousStopID,
			&t.NextStopID,
			&t.NextStopSequence,
			&t.Status,
			&t.ArrivalDelaySeconds,
			&t.DepartureDelaySeconds,
			&t.ScheduleRelationship,
			&predArrStr,
			&predDepStr,
			&vehTsStr,
			&polledAtStr,
			&updatedAtStr,
			&snapshotIDStr,
			&tripUpTsStr,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan train row: %w", err)
		}

		// Convert string timestamps to time.Time
		t.PredictedArrivalUTC = parseTimeString(predArrStr)
		t.PredictedDepartureUTC = parseTimeString(predDepStr)
		t.VehicleTimestampUTC = parseTimeString(vehTsStr)
		t.TripUpdateTimestampUTC = parseTimeString(tripUpTsStr)
		if polledAtStr != nil {
			if pt := parseTimeString(polledAtStr); pt != nil {
				t.PolledAtUTC = *pt
			}
		}
		if updatedAtStr != nil {
			if ut := parseTimeString(updatedAtStr); ut != nil {
				t.UpdatedAt = *ut
			}
		}

		trains = append(trains, t)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating train rows: %w", err)
	}

	return trains, nil
}

// GetTrainByKey returns a single train by its vehicle key
func (r *SQLiteTrainRepository) GetTrainByKey(ctx context.Context, vehicleKey string) (*models.Train, error) {
	if vehicleKey == "" {
		return nil, errors.New("vehicle_key cannot be empty")
	}

	query := `
		SELECT
			vehicle_key,
			vehicle_id,
			vehicle_label,
			entity_id,
			trip_id,
			route_id,
			latitude,
			longitude,
			current_stop_id,
			previous_stop_id,
			next_stop_id,
			next_stop_sequence,
			status,
			arrival_delay_seconds,
			departure_delay_seconds,
			schedule_relationship,
			predicted_arrival_utc,
			predicted_departure_utc,
			vehicle_timestamp_utc,
			polled_at_utc,
			updated_at,
			snapshot_id,
			trip_update_timestamp_utc
		FROM rt_rodalies_vehicle_current
		WHERE vehicle_key = ?
	`

	var t models.Train
	var predArrStr, predDepStr, vehTsStr, polledAtStr, updatedAtStr, snapshotIDStr, tripUpTsStr *string
	err := r.db.QueryRowContext(ctx, query, vehicleKey).Scan(
		&t.VehicleKey,
		&t.VehicleID,
		&t.VehicleLabel,
		&t.EntityID,
		&t.TripID,
		&t.RouteID,
		&t.Latitude,
		&t.Longitude,
		&t.CurrentStopID,
		&t.PreviousStopID,
		&t.NextStopID,
		&t.NextStopSequence,
		&t.Status,
		&t.ArrivalDelaySeconds,
		&t.DepartureDelaySeconds,
		&t.ScheduleRelationship,
		&predArrStr,
		&predDepStr,
		&vehTsStr,
		&polledAtStr,
		&updatedAtStr,
		&snapshotIDStr,
		&tripUpTsStr,
	)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("train not found: %s", vehicleKey)
		}
		return nil, fmt.Errorf("failed to query train: %w", err)
	}

	// Convert string timestamps to time.Time
	t.PredictedArrivalUTC = parseTimeString(predArrStr)
	t.PredictedDepartureUTC = parseTimeString(predDepStr)
	t.VehicleTimestampUTC = parseTimeString(vehTsStr)
	t.TripUpdateTimestampUTC = parseTimeString(tripUpTsStr)
	if polledAtStr != nil {
		if pt := parseTimeString(polledAtStr); pt != nil {
			t.PolledAtUTC = *pt
		}
	}
	if updatedAtStr != nil {
		if ut := parseTimeString(updatedAtStr); ut != nil {
			t.UpdatedAt = *ut
		}
	}

	return &t, nil
}

// GetTrainsByRoute returns trains on a specific route
func (r *SQLiteTrainRepository) GetTrainsByRoute(ctx context.Context, routeID string) ([]models.Train, error) {
	if routeID == "" {
		return nil, errors.New("route_id cannot be empty")
	}

	query := `
		SELECT
			vehicle_key,
			vehicle_id,
			vehicle_label,
			entity_id,
			trip_id,
			route_id,
			latitude,
			longitude,
			current_stop_id,
			previous_stop_id,
			next_stop_id,
			next_stop_sequence,
			status,
			arrival_delay_seconds,
			departure_delay_seconds,
			schedule_relationship,
			predicted_arrival_utc,
			predicted_departure_utc,
			vehicle_timestamp_utc,
			polled_at_utc,
			updated_at,
			snapshot_id,
			trip_update_timestamp_utc
		FROM rt_rodalies_vehicle_current
		WHERE route_id = ?
		  AND datetime(updated_at) > datetime('now', '-10 minutes')
		ORDER BY next_stop_sequence
	`

	rows, err := r.db.QueryContext(ctx, query, routeID)
	if err != nil {
		return nil, fmt.Errorf("failed to query trains by route: %w", err)
	}
	defer rows.Close()

	var trains []models.Train
	for rows.Next() {
		var t models.Train
		var predArrStr, predDepStr, vehTsStr, polledAtStr, updatedAtStr, snapshotIDStr, tripUpTsStr *string
		err := rows.Scan(
			&t.VehicleKey,
			&t.VehicleID,
			&t.VehicleLabel,
			&t.EntityID,
			&t.TripID,
			&t.RouteID,
			&t.Latitude,
			&t.Longitude,
			&t.CurrentStopID,
			&t.PreviousStopID,
			&t.NextStopID,
			&t.NextStopSequence,
			&t.Status,
			&t.ArrivalDelaySeconds,
			&t.DepartureDelaySeconds,
			&t.ScheduleRelationship,
			&predArrStr,
			&predDepStr,
			&vehTsStr,
			&polledAtStr,
			&updatedAtStr,
			&snapshotIDStr,
			&tripUpTsStr,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan train row: %w", err)
		}

		// Convert string timestamps to time.Time
		t.PredictedArrivalUTC = parseTimeString(predArrStr)
		t.PredictedDepartureUTC = parseTimeString(predDepStr)
		t.VehicleTimestampUTC = parseTimeString(vehTsStr)
		t.TripUpdateTimestampUTC = parseTimeString(tripUpTsStr)
		if polledAtStr != nil {
			if pt := parseTimeString(polledAtStr); pt != nil {
				t.PolledAtUTC = *pt
			}
		}
		if updatedAtStr != nil {
			if ut := parseTimeString(updatedAtStr); ut != nil {
				t.UpdatedAt = *ut
			}
		}

		trains = append(trains, t)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating train rows: %w", err)
	}

	return trains, nil
}

// GetAllTrainPositions returns all current train positions (lightweight)
func (r *SQLiteTrainRepository) GetAllTrainPositions(ctx context.Context) ([]models.TrainPosition, error) {
	current, _, _, _, err := r.GetTrainPositionsWithHistory(ctx)
	if err != nil {
		return nil, err
	}
	return current, nil
}

// GetTrainPositionsWithHistory returns current and previous positions for animation
func (r *SQLiteTrainRepository) GetTrainPositionsWithHistory(
	ctx context.Context,
) ([]models.TrainPosition, []models.TrainPosition, time.Time, *time.Time, error) {
	// Get the current snapshot ID
	const currentSnapshotQuery = `
		SELECT c.snapshot_id, s.polled_at_utc
		FROM rt_rodalies_vehicle_current c
		JOIN rt_snapshots s ON s.snapshot_id = c.snapshot_id
		ORDER BY s.polled_at_utc DESC
		LIMIT 1
	`

	var currentSnapshotID string
	var currentPolledAtStr string

	if err := r.db.QueryRowContext(ctx, currentSnapshotQuery).Scan(&currentSnapshotID, &currentPolledAtStr); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return []models.TrainPosition{}, nil, time.Time{}, nil, nil
		}
		return nil, nil, time.Time{}, nil, fmt.Errorf("failed to fetch current snapshot: %w", err)
	}

	currentPolledAt, _ := time.Parse(time.RFC3339, currentPolledAtStr)

	// Fetch current positions
	currentPositions, err := r.fetchPositionsForSnapshot(ctx, "rt_rodalies_vehicle_current", currentSnapshotID)
	if err != nil {
		return nil, nil, time.Time{}, nil, fmt.Errorf("failed to fetch current train positions: %w", err)
	}

	// Get the previous snapshot for animation interpolation
	const previousSnapshotQuery = `
		SELECT s.snapshot_id, s.polled_at_utc
		FROM rt_rodalies_vehicle_history h
		JOIN rt_snapshots s ON s.snapshot_id = h.snapshot_id
		WHERE s.polled_at_utc < ?
		GROUP BY s.snapshot_id, s.polled_at_utc
		ORDER BY s.polled_at_utc DESC
		LIMIT 1
	`

	var previousPositions []models.TrainPosition
	var previousPolledAtPtr *time.Time

	var previousSnapshotID string
	var previousPolledAtStr string

	err = r.db.QueryRowContext(ctx, previousSnapshotQuery, currentPolledAtStr).Scan(&previousSnapshotID, &previousPolledAtStr)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, nil, time.Time{}, nil, fmt.Errorf("failed to fetch previous snapshot: %w", err)
		}
	} else {
		previousPolledAt, _ := time.Parse(time.RFC3339, previousPolledAtStr)
		previousPolledAtPtr = &previousPolledAt

		previousPositions, err = r.fetchPositionsForSnapshot(ctx, "rt_rodalies_vehicle_history", previousSnapshotID)
		if err != nil {
			return nil, nil, time.Time{}, nil, fmt.Errorf("failed to fetch previous train positions: %w", err)
		}
	}

	return currentPositions, previousPositions, currentPolledAt, previousPolledAtPtr, nil
}

func (r *SQLiteTrainRepository) fetchPositionsForSnapshot(
	ctx context.Context,
	table string,
	snapshotID string,
) ([]models.TrainPosition, error) {
	query := fmt.Sprintf(`
		SELECT
			vehicle_key,
			latitude,
			longitude,
			next_stop_id,
			route_id,
			status,
			polled_at_utc
		FROM %s
		WHERE snapshot_id = ?
		ORDER BY vehicle_key
	`, table)

	rows, err := r.db.QueryContext(ctx, query, snapshotID)
	if err != nil {
		return nil, fmt.Errorf("failed to query train positions: %w", err)
	}
	defer rows.Close()

	var positions []models.TrainPosition
	for rows.Next() {
		var p models.TrainPosition
		var polledAtStr string
		var status, nextStopID, routeID sql.NullString
		if err := rows.Scan(
			&p.VehicleKey,
			&p.Latitude,
			&p.Longitude,
			&nextStopID,
			&routeID,
			&status,
			&polledAtStr,
		); err != nil {
			return nil, fmt.Errorf("failed to scan position row: %w", err)
		}
		if status.Valid {
			p.Status = &status.String
		}
		if nextStopID.Valid {
			p.NextStopID = &nextStopID.String
		}
		if routeID.Valid {
			p.RouteID = &routeID.String
		}
		if polledAt, err := time.Parse(time.RFC3339, polledAtStr); err == nil {
			p.PolledAtUTC = polledAt
		}
		positions = append(positions, p)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating position rows: %w", err)
	}

	return positions, nil
}

// GetTripDetails returns trip details with stop times from GTFS dimension tables
func (r *SQLiteTrainRepository) GetTripDetails(ctx context.Context, tripID string) (*models.TripDetails, error) {
	if tripID == "" {
		return nil, errors.New("trip_id cannot be empty")
	}

	// First, get the trip info from dim_trips
	tripQuery := `
		SELECT trip_id, route_id
		FROM dim_trips
		WHERE trip_id = ?
	`

	var details models.TripDetails
	err := r.db.QueryRowContext(ctx, tripQuery, tripID).Scan(
		&details.TripID,
		&details.RouteID,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("trip not found: %s", tripID)
		}
		return nil, fmt.Errorf("failed to query trip: %w", err)
	}

	// Now get all stop times for this trip, joined with stop info
	stopTimesQuery := `
		SELECT
			st.stop_id,
			st.stop_sequence,
			s.stop_name,
			st.arrival_seconds,
			st.departure_seconds
		FROM dim_stop_times st
		LEFT JOIN dim_stops s ON st.stop_id = s.stop_id AND st.network = s.network
		WHERE st.trip_id = ?
		ORDER BY st.stop_sequence
	`

	rows, err := r.db.QueryContext(ctx, stopTimesQuery, tripID)
	if err != nil {
		return nil, fmt.Errorf("failed to query stop times: %w", err)
	}
	defer rows.Close()

	var stopTimes []models.StopTime
	for rows.Next() {
		var st models.StopTime
		var arrivalSeconds, departureSeconds sql.NullInt64
		var stopName sql.NullString

		err := rows.Scan(
			&st.StopID,
			&st.StopSequence,
			&stopName,
			&arrivalSeconds,
			&departureSeconds,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan stop time row: %w", err)
		}

		if stopName.Valid {
			st.StopName = &stopName.String
		}

		// Convert seconds since midnight to HH:MM:SS format
		if arrivalSeconds.Valid {
			timeStr := secondsToTimeString(int(arrivalSeconds.Int64))
			st.ScheduledArrival = &timeStr
		}
		if departureSeconds.Valid {
			timeStr := secondsToTimeString(int(departureSeconds.Int64))
			st.ScheduledDeparture = &timeStr
		}

		stopTimes = append(stopTimes, st)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating stop time rows: %w", err)
	}

	details.StopTimes = stopTimes

	// Set UpdatedAt to current time (static GTFS data doesn't have an update timestamp)
	now := time.Now()
	details.UpdatedAt = &now

	return &details, nil
}

// secondsToTimeString converts seconds since midnight to HH:MM:SS format
func secondsToTimeString(seconds int) string {
	hours := seconds / 3600
	minutes := (seconds % 3600) / 60
	secs := seconds % 60
	return fmt.Sprintf("%02d:%02d:%02d", hours, minutes, secs)
}

// SQLiteMetroRepository handles database operations for Metro using SQLite
type SQLiteMetroRepository struct {
	db *sql.DB
}

// NewSQLiteMetroRepository creates a new SQLiteMetroRepository
func NewSQLiteMetroRepository(db *sql.DB) *SQLiteMetroRepository {
	return &SQLiteMetroRepository{db: db}
}

// GetAllMetroPositions returns all current Metro vehicle positions
func (r *SQLiteMetroRepository) GetAllMetroPositions(ctx context.Context) ([]models.MetroPosition, error) {
	current, _, _, _, err := r.GetMetroPositionsWithHistory(ctx, "")
	if err != nil {
		return nil, err
	}
	return current, nil
}

// GetMetroPositionsByLine returns Metro positions for a specific line
func (r *SQLiteMetroRepository) GetMetroPositionsByLine(ctx context.Context, lineCode string) ([]models.MetroPosition, error) {
	if lineCode == "" {
		return nil, errors.New("line_code cannot be empty")
	}
	current, _, _, _, err := r.GetMetroPositionsWithHistory(ctx, lineCode)
	if err != nil {
		return nil, err
	}
	return current, nil
}

// GetMetroPositionsWithHistory returns current and previous Metro positions for animation
func (r *SQLiteMetroRepository) GetMetroPositionsWithHistory(
	ctx context.Context,
	lineCode string,
) ([]models.MetroPosition, []models.MetroPosition, time.Time, *time.Time, error) {
	// Get the most recent polled_at_utc directly from metro current table
	// (don't join rt_snapshots as old snapshots may be cleaned up)
	const currentPolledAtQuery = `
		SELECT polled_at_utc
		FROM rt_metro_vehicle_current
		ORDER BY polled_at_utc DESC
		LIMIT 1
	`

	var currentPolledAtStr string

	if err := r.db.QueryRowContext(ctx, currentPolledAtQuery).Scan(&currentPolledAtStr); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return []models.MetroPosition{}, nil, time.Time{}, nil, nil
		}
		return nil, nil, time.Time{}, nil, fmt.Errorf("failed to fetch current polled_at: %w", err)
	}

	currentPolledAt, _ := time.Parse(time.RFC3339, currentPolledAtStr)

	// Fetch all current positions (no snapshot filtering needed - current table only has latest)
	currentPositions, err := r.fetchAllMetroPositions(ctx, lineCode)
	if err != nil {
		return nil, nil, time.Time{}, nil, fmt.Errorf("failed to fetch current metro positions: %w", err)
	}

	// Get previous positions from history for animation interpolation
	// Use polled_at_utc directly from history table (don't depend on rt_snapshots)
	const previousPolledAtQuery = `
		SELECT polled_at_utc
		FROM rt_metro_vehicle_history
		WHERE polled_at_utc < ?
		ORDER BY polled_at_utc DESC
		LIMIT 1
	`

	var previousPositions []models.MetroPosition
	var previousPolledAtPtr *time.Time

	var previousPolledAtStr string

	err = r.db.QueryRowContext(ctx, previousPolledAtQuery, currentPolledAtStr).Scan(&previousPolledAtStr)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, nil, time.Time{}, nil, fmt.Errorf("failed to fetch previous polled_at: %w", err)
		}
	} else {
		previousPolledAt, _ := time.Parse(time.RFC3339, previousPolledAtStr)
		previousPolledAtPtr = &previousPolledAt

		previousPositions, err = r.fetchMetroHistoryPositions(ctx, previousPolledAtStr, lineCode)
		if err != nil {
			return nil, nil, time.Time{}, nil, fmt.Errorf("failed to fetch previous metro positions: %w", err)
		}
	}

	return currentPositions, previousPositions, currentPolledAt, previousPolledAtPtr, nil
}

func (r *SQLiteMetroRepository) fetchMetroPositionsForSnapshot(
	ctx context.Context,
	table string,
	snapshotID string,
	lineCode string,
) ([]models.MetroPosition, error) {
	var query string
	var args []interface{}

	baseQuery := `
		SELECT
			vehicle_key,
			line_code,
			route_id,
			direction_id,
			latitude,
			longitude,
			bearing,
			previous_stop_id,
			next_stop_id,
			previous_stop_name,
			next_stop_name,
			status,
			progress_fraction,
			distance_along_line,
			estimated_speed_mps,
			line_total_length,
			source,
			confidence,
			arrival_seconds_to_next,
			estimated_at_utc,
			polled_at_utc
		FROM %s
		WHERE snapshot_id = ?
	`

	if lineCode != "" {
		query = fmt.Sprintf(baseQuery+" AND line_code = ? ORDER BY direction_id, vehicle_key", table)
		args = []interface{}{snapshotID, lineCode}
	} else {
		query = fmt.Sprintf(baseQuery+" ORDER BY line_code, direction_id, vehicle_key", table)
		args = []interface{}{snapshotID}
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query metro positions: %w", err)
	}
	defer rows.Close()

	var positions []models.MetroPosition
	for rows.Next() {
		var p models.MetroPosition
		var estimatedAtStr, polledAtStr sql.NullString
		if err := rows.Scan(
			&p.VehicleKey,
			&p.LineCode,
			&p.RouteID,
			&p.DirectionID,
			&p.Latitude,
			&p.Longitude,
			&p.Bearing,
			&p.PreviousStopID,
			&p.NextStopID,
			&p.PreviousStopName,
			&p.NextStopName,
			&p.Status,
			&p.ProgressFraction,
			&p.DistanceAlongLine,
			&p.SpeedMetersPerSec,
			&p.LineTotalLength,
			&p.Source,
			&p.Confidence,
			&p.ArrivalSecondsToNext,
			&estimatedAtStr,
			&polledAtStr,
		); err != nil {
			return nil, fmt.Errorf("failed to scan metro position row: %w", err)
		}

		// Parse timestamp strings
		if estimatedAtStr.Valid {
			if t, err := time.Parse(time.RFC3339, estimatedAtStr.String); err == nil {
				p.EstimatedAtUTC = t
			}
		}
		if polledAtStr.Valid {
			if t, err := time.Parse(time.RFC3339, polledAtStr.String); err == nil {
				p.PolledAtUTC = t
			}
		}

		// Set constant fields
		p.NetworkType = "metro"
		p.LineColor = models.GetLineColor(p.LineCode)

		positions = append(positions, p)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating metro position rows: %w", err)
	}

	return positions, nil
}

// fetchAllMetroPositions fetches all current metro positions (no snapshot filter)
func (r *SQLiteMetroRepository) fetchAllMetroPositions(
	ctx context.Context,
	lineCode string,
) ([]models.MetroPosition, error) {
	var query string
	var args []interface{}

	baseQuery := `
		SELECT
			vehicle_key,
			line_code,
			route_id,
			direction_id,
			latitude,
			longitude,
			bearing,
			previous_stop_id,
			next_stop_id,
			previous_stop_name,
			next_stop_name,
			status,
			progress_fraction,
			distance_along_line,
			estimated_speed_mps,
			line_total_length,
			source,
			confidence,
			arrival_seconds_to_next,
			estimated_at_utc,
			polled_at_utc
		FROM rt_metro_vehicle_current
	`

	if lineCode != "" {
		query = baseQuery + " WHERE line_code = ? ORDER BY direction_id, vehicle_key"
		args = []interface{}{lineCode}
	} else {
		query = baseQuery + " ORDER BY line_code, direction_id, vehicle_key"
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query metro positions: %w", err)
	}
	defer rows.Close()

	return r.scanMetroPositions(rows)
}

// fetchMetroHistoryPositions fetches metro positions from history at a specific polled_at_utc
func (r *SQLiteMetroRepository) fetchMetroHistoryPositions(
	ctx context.Context,
	polledAtUTC string,
	lineCode string,
) ([]models.MetroPosition, error) {
	var query string
	var args []interface{}

	baseQuery := `
		SELECT
			vehicle_key,
			line_code,
			'' as route_id,
			direction_id,
			latitude,
			longitude,
			bearing,
			previous_stop_id,
			next_stop_id,
			'' as previous_stop_name,
			'' as next_stop_name,
			status,
			progress_fraction,
			0.0 as distance_along_line,
			0.0 as estimated_speed_mps,
			0.0 as line_total_length,
			'history' as source,
			'low' as confidence,
			0 as arrival_seconds_to_next,
			polled_at_utc as estimated_at_utc,
			polled_at_utc
		FROM rt_metro_vehicle_history
		WHERE polled_at_utc = ?
	`

	if lineCode != "" {
		query = baseQuery + " AND line_code = ? ORDER BY direction_id, vehicle_key"
		args = []interface{}{polledAtUTC, lineCode}
	} else {
		query = baseQuery + " ORDER BY line_code, direction_id, vehicle_key"
		args = []interface{}{polledAtUTC}
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query metro history positions: %w", err)
	}
	defer rows.Close()

	return r.scanMetroPositions(rows)
}

// scanMetroPositions scans rows into MetroPosition slice
func (r *SQLiteMetroRepository) scanMetroPositions(rows *sql.Rows) ([]models.MetroPosition, error) {
	var positions []models.MetroPosition
	for rows.Next() {
		var p models.MetroPosition
		var estimatedAtStr, polledAtStr sql.NullString
		if err := rows.Scan(
			&p.VehicleKey,
			&p.LineCode,
			&p.RouteID,
			&p.DirectionID,
			&p.Latitude,
			&p.Longitude,
			&p.Bearing,
			&p.PreviousStopID,
			&p.NextStopID,
			&p.PreviousStopName,
			&p.NextStopName,
			&p.Status,
			&p.ProgressFraction,
			&p.DistanceAlongLine,
			&p.SpeedMetersPerSec,
			&p.LineTotalLength,
			&p.Source,
			&p.Confidence,
			&p.ArrivalSecondsToNext,
			&estimatedAtStr,
			&polledAtStr,
		); err != nil {
			return nil, fmt.Errorf("failed to scan metro position row: %w", err)
		}

		// Parse timestamp strings
		if estimatedAtStr.Valid {
			if t, err := time.Parse(time.RFC3339, estimatedAtStr.String); err == nil {
				p.EstimatedAtUTC = t
			}
		}
		if polledAtStr.Valid {
			if t, err := time.Parse(time.RFC3339, polledAtStr.String); err == nil {
				p.PolledAtUTC = t
			}
		}

		// Set constant fields
		p.NetworkType = "metro"
		p.LineColor = models.GetLineColor(p.LineCode)

		positions = append(positions, p)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating metro position rows: %w", err)
	}

	return positions, nil
}

// SQLiteScheduleRepository handles database operations for schedule-estimated positions
type SQLiteScheduleRepository struct {
	db *sql.DB
}

// NewSQLiteScheduleRepository creates a new SQLiteScheduleRepository
func NewSQLiteScheduleRepository(db *sql.DB) *SQLiteScheduleRepository {
	return &SQLiteScheduleRepository{db: db}
}

// Barcelona timezone for schedule lookups
var barcelonaTZ *time.Location

func init() {
	var err error
	barcelonaTZ, err = time.LoadLocation("Europe/Madrid")
	if err != nil {
		// Fallback to UTC+1 if timezone data not available
		barcelonaTZ = time.FixedZone("CET", 3600)
	}
}

// preCalcPosition represents a position from the pre-calculated JSON
type preCalcPosition struct {
	VehicleKey       string   `json:"vehicleKey"`
	RouteID          string   `json:"routeId"`
	RouteShortName   string   `json:"routeShortName"`
	RouteLongName    string   `json:"routeLongName,omitempty"`
	RouteColor       string   `json:"routeColor"`
	TripID           string   `json:"tripId"`
	DirectionID      int      `json:"direction"`
	Latitude         float64  `json:"latitude"`
	Longitude        float64  `json:"longitude"`
	Bearing          *float64 `json:"bearing,omitempty"`
	PrevStopID       string   `json:"prevStopId,omitempty"`
	NextStopID       string   `json:"nextStopId,omitempty"`
	PrevStopName     string   `json:"prevStopName,omitempty"`
	NextStopName     string   `json:"nextStopName,omitempty"`
	ProgressFraction float64  `json:"progressFraction"`
	ScheduledArrival string   `json:"scheduledArrival,omitempty"`
}

// GetAllSchedulePositions returns all current schedule-estimated positions from pre-calculated data
func (r *SQLiteScheduleRepository) GetAllSchedulePositions(ctx context.Context) ([]models.SchedulePosition, time.Time, error) {
	return r.GetSchedulePositionsByNetwork(ctx, "")
}

// getDayType returns the day type for a given weekday
func getDayType(weekday time.Weekday) string {
	switch weekday {
	case time.Sunday:
		return "sunday"
	case time.Monday, time.Tuesday, time.Wednesday, time.Thursday:
		return "weekday"
	case time.Friday:
		return "friday"
	case time.Saturday:
		return "saturday"
	default:
		return "weekday"
	}
}

// GetSchedulePositionsByNetwork returns schedule-estimated positions filtered by network type
// Reads from pre_schedule_positions table using current Barcelona time and day type
func (r *SQLiteScheduleRepository) GetSchedulePositionsByNetwork(ctx context.Context, networkType string) ([]models.SchedulePosition, time.Time, error) {
	// Get current time in Barcelona timezone
	now := time.Now().In(barcelonaTZ)
	dayType := getDayType(now.Weekday())
	secondsSinceMidnight := now.Hour()*3600 + now.Minute()*60 + now.Second()
	timeSlot := secondsSinceMidnight / 30 // 30-second intervals

	// Build query based on network filter
	var query string
	var args []interface{}

	if networkType != "" {
		// Map display network type to database network values
		networks := []string{networkType}
		if networkType == "tram" {
			networks = []string{"tram_tbs", "tram_tbx"}
		}

		placeholders := "?"
		args = []interface{}{dayType, timeSlot, networks[0]}
		for i := 1; i < len(networks); i++ {
			placeholders += ", ?"
			args = append(args, networks[i])
		}

		query = fmt.Sprintf(`
			SELECT network, positions_json
			FROM pre_schedule_positions
			WHERE day_type = ? AND time_slot = ? AND network IN (%s)
		`, placeholders)
	} else {
		query = `
			SELECT network, positions_json
			FROM pre_schedule_positions
			WHERE day_type = ? AND time_slot = ?
		`
		args = []interface{}{dayType, timeSlot}
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("failed to query pre-calculated positions: %w", err)
	}
	defer rows.Close()

	var allPositions []models.SchedulePosition

	for rows.Next() {
		var network, positionsJSON string
		if err := rows.Scan(&network, &positionsJSON); err != nil {
			return nil, time.Time{}, fmt.Errorf("failed to scan pre-calc row: %w", err)
		}

		// Parse JSON positions
		var preCalcPositions []preCalcPosition
		if err := json.Unmarshal([]byte(positionsJSON), &preCalcPositions); err != nil {
			return nil, time.Time{}, fmt.Errorf("failed to parse positions JSON: %w", err)
		}

		// Convert to model positions
		displayNetwork := network
		if network == "tram_tbs" || network == "tram_tbx" {
			displayNetwork = "tram"
		}

		for _, p := range preCalcPositions {
			pos := models.SchedulePosition{
				VehicleKey:     p.VehicleKey,
				NetworkType:    displayNetwork,
				RouteID:        p.RouteID,
				RouteShortName: p.RouteShortName,
				RouteLongName:  p.RouteLongName,
				RouteColor:     p.RouteColor,
				TripID:         p.TripID,
				DirectionID:    p.DirectionID,
				Latitude:       p.Latitude,
				Longitude:      p.Longitude,
				Bearing:        p.Bearing,
				Status:         "IN_TRANSIT_TO",
				Source:         "schedule",
				Confidence:     "low",
				EstimatedAtUTC: now.UTC(),
				PolledAtUTC:    now.UTC(),
			}

			if p.PrevStopID != "" {
				pos.PreviousStopID = &p.PrevStopID
			}
			if p.NextStopID != "" {
				pos.NextStopID = &p.NextStopID
			}
			if p.PrevStopName != "" {
				pos.PreviousStopName = &p.PrevStopName
			}
			if p.NextStopName != "" {
				pos.NextStopName = &p.NextStopName
			}
			if p.ProgressFraction > 0 {
				pf := p.ProgressFraction
				pos.ProgressFraction = &pf
			}
			if p.ScheduledArrival != "" {
				pos.ScheduledArrival = &p.ScheduledArrival
			}

			allPositions = append(allPositions, pos)
		}
	}

	if err := rows.Err(); err != nil {
		return nil, time.Time{}, fmt.Errorf("error iterating pre-calc rows: %w", err)
	}

	return allPositions, now.UTC(), nil
}
