package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/you/myapp/apps/api/models"
)

// MetroRepository handles database operations for Metro vehicle positions
type MetroRepository struct {
	pool *pgxpool.Pool
}

// NewMetroRepository creates a new MetroRepository using an existing connection pool
func NewMetroRepository(pool *pgxpool.Pool) *MetroRepository {
	return &MetroRepository{pool: pool}
}

// GetAllMetroPositions returns all current Metro vehicle positions
func (r *MetroRepository) GetAllMetroPositions(ctx context.Context) ([]models.MetroPosition, error) {
	current, _, _, _, err := r.GetMetroPositionsWithHistory(ctx, "")
	if err != nil {
		return nil, err
	}
	return current, nil
}

// GetMetroPositionsByLine returns Metro vehicle positions for a specific line
func (r *MetroRepository) GetMetroPositionsByLine(ctx context.Context, lineCode string) ([]models.MetroPosition, error) {
	if lineCode == "" {
		return nil, errors.New("line_code cannot be empty")
	}
	current, _, _, _, err := r.GetMetroPositionsWithHistory(ctx, lineCode)
	if err != nil {
		return nil, err
	}
	return current, nil
}

// GetMetroPositionsWithHistory returns the latest snapshot of Metro positions along with
// the immediately preceding snapshot (for frontend animation interpolation).
// If lineCode is empty, returns all lines.
func (r *MetroRepository) GetMetroPositionsWithHistory(
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

	var currentSnapshotID uuid.UUID
	var currentPolledAt time.Time

	if err := r.pool.QueryRow(ctx, currentSnapshotQuery).Scan(&currentSnapshotID, &currentPolledAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// No data available yet
			return []models.MetroPosition{}, nil, time.Time{}, nil, nil
		}
		return nil, nil, time.Time{}, nil, fmt.Errorf("failed to fetch current snapshot: %w", err)
	}

	// Fetch current positions
	currentPositions, err := r.fetchPositionsForSnapshot(ctx, "rt_metro_vehicle_current", currentSnapshotID, lineCode)
	if err != nil {
		return nil, nil, time.Time{}, nil, fmt.Errorf("failed to fetch current metro positions: %w", err)
	}

	// Get the previous snapshot for animation interpolation
	const previousSnapshotQuery = `
		SELECT s.snapshot_id, s.polled_at_utc
		FROM rt_metro_vehicle_history h
		JOIN rt_snapshots s ON s.snapshot_id = h.snapshot_id
		WHERE s.polled_at_utc < $1
		GROUP BY s.snapshot_id, s.polled_at_utc
		ORDER BY s.polled_at_utc DESC
		LIMIT 1
	`

	var previousPositions []models.MetroPosition
	var previousPolledAtPtr *time.Time

	var previousSnapshotID uuid.UUID
	var previousPolledAt time.Time

	err = r.pool.QueryRow(ctx, previousSnapshotQuery, currentPolledAt).Scan(&previousSnapshotID, &previousPolledAt)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, time.Time{}, nil, fmt.Errorf("failed to fetch previous snapshot: %w", err)
		}
		// No previous snapshot available, that's OK
	} else {
		previousPolledAtPtr = &previousPolledAt

		previousPositions, err = r.fetchPositionsForSnapshot(ctx, "rt_metro_vehicle_history", previousSnapshotID, lineCode)
		if err != nil {
			return nil, nil, time.Time{}, nil, fmt.Errorf("failed to fetch previous metro positions: %w", err)
		}
	}

	return currentPositions, previousPositions, currentPolledAt, previousPolledAtPtr, nil
}

// fetchPositionsForSnapshot queries Metro positions from the specified table for a given snapshot
func (r *MetroRepository) fetchPositionsForSnapshot(
	ctx context.Context,
	table string,
	snapshotID uuid.UUID,
	lineCode string,
) ([]models.MetroPosition, error) {
	// Build query with optional line filter
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
		WHERE snapshot_id = $1
	`

	if lineCode != "" {
		query = fmt.Sprintf(baseQuery+" AND line_code = $2 ORDER BY direction_id, vehicle_key", table)
		args = []interface{}{snapshotID, lineCode}
	} else {
		query = fmt.Sprintf(baseQuery+" ORDER BY line_code, direction_id, vehicle_key", table)
		args = []interface{}{snapshotID}
	}

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query metro positions: %w", err)
	}
	defer rows.Close()

	var positions []models.MetroPosition
	for rows.Next() {
		var p models.MetroPosition
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
			&p.EstimatedAtUTC,
			&p.PolledAtUTC,
		); err != nil {
			return nil, fmt.Errorf("failed to scan metro position row: %w", err)
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
