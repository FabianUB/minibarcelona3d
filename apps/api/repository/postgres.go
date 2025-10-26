package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/you/myapp/apps/api/models"
)

type TrainRepository struct {
	pool *pgxpool.Pool
}

func NewTrainRepository(databaseURL string) (*TrainRepository, error) {
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &TrainRepository{pool: pool}, nil
}

func (r *TrainRepository) Close() {
	r.pool.Close()
}

func (r *TrainRepository) GetAllTrains(ctx context.Context) ([]models.Train, error) {
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
		WHERE updated_at > NOW() - INTERVAL '10 minutes'
		ORDER BY vehicle_key
	`

	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query trains: %w", err)
	}
	defer rows.Close()

	var trains []models.Train
	for rows.Next() {
		var t models.Train
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
			&t.PredictedArrivalUTC,
			&t.PredictedDepartureUTC,
			&t.VehicleTimestampUTC,
			&t.PolledAtUTC,
			&t.UpdatedAt,
			&t.SnapshotID,
			&t.TripUpdateTimestampUTC,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan train row: %w", err)
		}
		trains = append(trains, t)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating train rows: %w", err)
	}

	return trains, nil
}

func (r *TrainRepository) GetTrainByKey(ctx context.Context, vehicleKey string) (*models.Train, error) {
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
		WHERE vehicle_key = $1
	`

	var t models.Train
	err := r.pool.QueryRow(ctx, query, vehicleKey).Scan(
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
		&t.PredictedArrivalUTC,
		&t.PredictedDepartureUTC,
		&t.VehicleTimestampUTC,
		&t.PolledAtUTC,
		&t.UpdatedAt,
		&t.SnapshotID,
		&t.TripUpdateTimestampUTC,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("train not found: %s", vehicleKey)
		}
		return nil, fmt.Errorf("failed to query train: %w", err)
	}

	return &t, nil
}

func (r *TrainRepository) GetTrainsByRoute(ctx context.Context, routeID string) ([]models.Train, error) {
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
		WHERE route_id = $1
		  AND updated_at > NOW() - INTERVAL '10 minutes'
		ORDER BY next_stop_sequence
	`

	rows, err := r.pool.Query(ctx, query, routeID)
	if err != nil {
		return nil, fmt.Errorf("failed to query trains by route: %w", err)
	}
	defer rows.Close()

	var trains []models.Train
	for rows.Next() {
		var t models.Train
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
			&t.PredictedArrivalUTC,
			&t.PredictedDepartureUTC,
			&t.VehicleTimestampUTC,
			&t.PolledAtUTC,
			&t.UpdatedAt,
			&t.SnapshotID,
			&t.TripUpdateTimestampUTC,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan train row: %w", err)
		}
		trains = append(trains, t)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating train rows: %w", err)
	}

	return trains, nil
}

func (r *TrainRepository) GetAllTrainPositions(ctx context.Context) ([]models.TrainPosition, error) {
	query := `
		SELECT
			vehicle_key,
			latitude,
			longitude,
			next_stop_id,
			route_id,
			status,
			polled_at_utc
		FROM rt_rodalies_vehicle_current
		WHERE updated_at > NOW() - INTERVAL '10 minutes'
		ORDER BY vehicle_key
	`

	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query train positions: %w", err)
	}
	defer rows.Close()

	var positions []models.TrainPosition
	for rows.Next() {
		var p models.TrainPosition
		err := rows.Scan(
			&p.VehicleKey,
			&p.Latitude,
			&p.Longitude,
			&p.NextStopID,
			&p.RouteID,
			&p.Status,
			&p.PolledAtUTC,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan position row: %w", err)
		}
		positions = append(positions, p)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating position rows: %w", err)
	}

	return positions, nil
}
