package repository

import (
	"context"
	"database/sql"
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
	db, err := sql.Open("sqlite", dbPath+"?_journal=WAL&_fk=1")
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

// GetTripDetails returns trip details with stop times
func (r *SQLiteTrainRepository) GetTripDetails(ctx context.Context, tripID string) (*models.TripDetails, error) {
	// Since we're using SQLite without the full GTFS dimension tables for now,
	// return an error indicating trip details aren't available
	return nil, errors.New("trip details not available with SQLite backend")
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
	// Get the current snapshot ID
	const currentSnapshotQuery = `
		SELECT c.snapshot_id, s.polled_at_utc
		FROM rt_metro_vehicle_current c
		JOIN rt_snapshots s ON s.snapshot_id = c.snapshot_id
		ORDER BY s.polled_at_utc DESC
		LIMIT 1
	`

	var currentSnapshotID string
	var currentPolledAtStr string

	if err := r.db.QueryRowContext(ctx, currentSnapshotQuery).Scan(&currentSnapshotID, &currentPolledAtStr); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return []models.MetroPosition{}, nil, time.Time{}, nil, nil
		}
		return nil, nil, time.Time{}, nil, fmt.Errorf("failed to fetch current snapshot: %w", err)
	}

	currentPolledAt, _ := time.Parse(time.RFC3339, currentPolledAtStr)

	// Fetch current positions
	currentPositions, err := r.fetchMetroPositionsForSnapshot(ctx, "rt_metro_vehicle_current", currentSnapshotID, lineCode)
	if err != nil {
		return nil, nil, time.Time{}, nil, fmt.Errorf("failed to fetch current metro positions: %w", err)
	}

	// Get the previous snapshot for animation interpolation
	const previousSnapshotQuery = `
		SELECT s.snapshot_id, s.polled_at_utc
		FROM rt_metro_vehicle_history h
		JOIN rt_snapshots s ON s.snapshot_id = h.snapshot_id
		WHERE s.polled_at_utc < ?
		GROUP BY s.snapshot_id, s.polled_at_utc
		ORDER BY s.polled_at_utc DESC
		LIMIT 1
	`

	var previousPositions []models.MetroPosition
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

		previousPositions, err = r.fetchMetroPositionsForSnapshot(ctx, "rt_metro_vehicle_history", previousSnapshotID, lineCode)
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
