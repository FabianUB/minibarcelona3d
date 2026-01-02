package db

import (
	"context"
	"fmt"
	"log"
	"time"
)

// Cleanup deletes data older than the specified retention duration
func (db *DB) Cleanup(ctx context.Context, retention time.Duration) error {
	hours := int(retention.Hours())
	if hours < 1 {
		hours = 1
	}

	// Delete old history records
	queries := []struct {
		name  string
		query string
	}{
		{
			name:  "rodalies_history",
			query: fmt.Sprintf("DELETE FROM rt_rodalies_vehicle_history WHERE datetime(polled_at_utc) < datetime('now', '-%d hours')", hours),
		},
		{
			name:  "metro_history",
			query: fmt.Sprintf("DELETE FROM rt_metro_vehicle_history WHERE datetime(polled_at_utc) < datetime('now', '-%d hours')", hours),
		},
		{
			name:  "snapshots",
			query: fmt.Sprintf("DELETE FROM rt_snapshots WHERE datetime(polled_at_utc) < datetime('now', '-%d hours')", hours),
		},
	}

	totalDeleted := 0
	for _, q := range queries {
		result, err := db.conn.ExecContext(ctx, q.query)
		if err != nil {
			return fmt.Errorf("failed to cleanup %s: %w", q.name, err)
		}
		rows, _ := result.RowsAffected()
		totalDeleted += int(rows)
	}

	if totalDeleted > 0 {
		log.Printf("Cleanup: deleted %d records older than %d hours", totalDeleted, hours)
	}

	return nil
}
