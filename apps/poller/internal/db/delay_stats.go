package db

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"time"
)

// DelayThresholdSeconds is the threshold for a train to be considered "delayed" (5 minutes)
const DelayThresholdSeconds = 300

// DelayObservation represents a single delay measurement for a route
type DelayObservation struct {
	RouteID      string
	DelaySeconds int
}

// UpdateDelayStats aggregates delay observations into hourly stats using Welford's algorithm
func (db *DB) UpdateDelayStats(ctx context.Context, observations []DelayObservation) error {
	if len(observations) == 0 {
		return nil
	}

	// Group observations by route
	byRoute := make(map[string][]int)
	for _, obs := range observations {
		if obs.RouteID == "" {
			continue
		}
		byRoute[obs.RouteID] = append(byRoute[obs.RouteID], obs.DelaySeconds)
	}

	if len(byRoute) == 0 {
		return nil
	}

	// Current hour bucket (ISO8601 truncated to hour)
	hourBucket := time.Now().UTC().Truncate(time.Hour).Format(time.RFC3339)

	db.LockWrite()
	defer db.UnlockWrite()

	tx, err := db.conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	for routeID, delays := range byRoute {
		// Read existing row
		var count int
		var mean, m2 float64
		var delayedCount, onTimeCount, maxDelay int

		err := tx.QueryRowContext(ctx, `
			SELECT observation_count, delay_mean_seconds, delay_m2,
				delayed_count, on_time_count, max_delay_seconds
			FROM stats_delay_hourly
			WHERE route_id = ? AND hour_bucket = ?
		`, routeID, hourBucket).Scan(&count, &mean, &m2, &delayedCount, &onTimeCount, &maxDelay)

		if err != nil && err != sql.ErrNoRows {
			return fmt.Errorf("failed to read delay stats for %s: %w", routeID, err)
		}

		// Apply Welford's algorithm for each new observation
		for _, delaySec := range delays {
			absDelay := int(math.Abs(float64(delaySec)))

			count++
			delta := float64(delaySec) - mean
			mean += delta / float64(count)
			delta2 := float64(delaySec) - mean
			m2 += delta * delta2

			if absDelay > DelayThresholdSeconds {
				delayedCount++
			} else {
				onTimeCount++
			}
			if absDelay > maxDelay {
				maxDelay = absDelay
			}
		}

		// Upsert
		_, err = tx.ExecContext(ctx, `
			INSERT INTO stats_delay_hourly (route_id, hour_bucket, observation_count,
				delay_mean_seconds, delay_m2, delayed_count, on_time_count, max_delay_seconds)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (route_id, hour_bucket) DO UPDATE SET
				observation_count = excluded.observation_count,
				delay_mean_seconds = excluded.delay_mean_seconds,
				delay_m2 = excluded.delay_m2,
				delayed_count = excluded.delayed_count,
				on_time_count = excluded.on_time_count,
				max_delay_seconds = excluded.max_delay_seconds
		`, routeID, hourBucket, count, mean, m2, delayedCount, onTimeCount, maxDelay)
		if err != nil {
			return fmt.Errorf("failed to upsert delay stats for %s: %w", routeID, err)
		}
	}

	return tx.Commit()
}
