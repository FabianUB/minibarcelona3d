package db

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// Alert represents a service alert for database insertion
type Alert struct {
	AlertID           string
	Cause             string
	Effect            string
	DescriptionES     string
	DescriptionCA     string
	DescriptionEN     string
	ActivePeriodStart *string
	ActivePeriodEnd   *string
	LastSeenAt        time.Time
	Entities          []AlertEntity
}

// AlertEntity represents an affected route/stop/trip
type AlertEntity struct {
	RouteID string
	StopID  string
	TripID  string
}

// UpsertAlerts inserts or updates alerts and their entities
func (db *DB) UpsertAlerts(ctx context.Context, alerts []Alert) error {
	if len(alerts) == 0 {
		return nil
	}

	db.LockWrite()
	defer db.UnlockWrite()

	tx, err := db.conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	now := time.Now().UTC().Format(time.RFC3339)

	alertStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO rt_alerts (alert_id, cause, effect, description_es, description_ca, description_en,
			active_period_start, active_period_end, is_active, first_seen_at, last_seen_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
		ON CONFLICT (alert_id) DO UPDATE SET
			cause = excluded.cause,
			effect = excluded.effect,
			description_es = excluded.description_es,
			description_ca = excluded.description_ca,
			description_en = excluded.description_en,
			active_period_start = excluded.active_period_start,
			active_period_end = excluded.active_period_end,
			is_active = 1,
			last_seen_at = excluded.last_seen_at,
			resolved_at = NULL
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare alert statement: %w", err)
	}
	defer alertStmt.Close()

	entityStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO rt_alert_entities (alert_id, route_id, stop_id, trip_id)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare entity statement: %w", err)
	}
	defer entityStmt.Close()

	for _, a := range alerts {
		lastSeenStr := a.LastSeenAt.Format(time.RFC3339)
		_, err := alertStmt.ExecContext(ctx,
			a.AlertID, a.Cause, a.Effect,
			a.DescriptionES, a.DescriptionCA, a.DescriptionEN,
			a.ActivePeriodStart, a.ActivePeriodEnd,
			now, lastSeenStr,
		)
		if err != nil {
			return fmt.Errorf("failed to upsert alert %s: %w", a.AlertID, err)
		}

		// Replace entities for this alert
		if _, err := tx.ExecContext(ctx, "DELETE FROM rt_alert_entities WHERE alert_id = ?", a.AlertID); err != nil {
			return fmt.Errorf("failed to clear entities for alert %s: %w", a.AlertID, err)
		}

		for _, e := range a.Entities {
			if _, err := entityStmt.ExecContext(ctx, a.AlertID, e.RouteID, e.StopID, e.TripID); err != nil {
				return fmt.Errorf("failed to insert entity for alert %s: %w", a.AlertID, err)
			}
		}
	}

	return tx.Commit()
}

// MarkResolvedAlerts marks alerts not in the active set as resolved
func (db *DB) MarkResolvedAlerts(ctx context.Context, activeIDs []string) error {
	db.LockWrite()
	defer db.UnlockWrite()

	now := time.Now().UTC().Format(time.RFC3339)

	if len(activeIDs) == 0 {
		// All alerts are resolved
		_, err := db.conn.ExecContext(ctx,
			"UPDATE rt_alerts SET is_active = 0, resolved_at = ? WHERE is_active = 1",
			now,
		)
		return err
	}

	// Build placeholders
	placeholders := make([]string, len(activeIDs))
	args := make([]interface{}, 0, len(activeIDs)+1)
	args = append(args, now)
	for i, id := range activeIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}

	query := fmt.Sprintf(
		"UPDATE rt_alerts SET is_active = 0, resolved_at = ? WHERE is_active = 1 AND alert_id NOT IN (%s)",
		strings.Join(placeholders, ","),
	)
	_, err := db.conn.ExecContext(ctx, query, args...)
	return err
}
