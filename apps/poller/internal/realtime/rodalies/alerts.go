package rodalies

import (
	"context"
	"log"
	"regexp"
	"time"

	"github.com/mini-rodalies-3d/poller/internal/db"
)

// rodaliesRouteRegex matches Rodalies/Cercanías line codes anywhere in a route ID.
// GTFS route IDs from Renfe embed the line code (e.g. "51T0048RL4", "300R4", "R2N").
var rodaliesRouteRegex = regexp.MustCompile(`(?i)(R\d+[NS]?|RG\d|RL\d|RT\d)`)

// ParsedAlert represents a service alert extracted from GTFS-RT
type ParsedAlert struct {
	AlertID           string
	Cause             string
	Effect            string
	DescriptionES     string
	DescriptionCA     string
	DescriptionEN     string
	ActivePeriodStart *time.Time
	ActivePeriodEnd   *time.Time
	Entities          []AlertEntity
}

// AlertEntity represents an affected route/stop/trip
type AlertEntity struct {
	RouteID string
	StopID  string
	TripID  string
}

// CauseMap maps GTFS-RT Cause enum to string
var CauseMap = map[int32]string{
	1:  "UNKNOWN_CAUSE",
	2:  "OTHER_CAUSE",
	3:  "TECHNICAL_PROBLEM",
	4:  "STRIKE",
	5:  "DEMONSTRATION",
	6:  "ACCIDENT",
	7:  "HOLIDAY",
	8:  "WEATHER",
	9:  "MAINTENANCE",
	10: "CONSTRUCTION",
	11: "POLICE_ACTIVITY",
	12: "MEDICAL_EMERGENCY",
}

// EffectMap maps GTFS-RT Effect enum to string
var EffectMap = map[int32]string{
	1:  "NO_SERVICE",
	2:  "REDUCED_SERVICE",
	3:  "SIGNIFICANT_DELAYS",
	4:  "DETOUR",
	5:  "ADDITIONAL_SERVICE",
	6:  "MODIFIED_SERVICE",
	7:  "OTHER_EFFECT",
	8:  "UNKNOWN_EFFECT",
	9:  "STOP_MOVED",
	10: "NO_EFFECT",
	11: "ACCESSIBILITY_ISSUE",
}

// fetchAlerts fetches and parses the alerts GTFS-RT feed
func (p *Poller) fetchAlerts(ctx context.Context) ([]ParsedAlert, error) {
	feed, err := p.fetchFeed(ctx, p.cfg.GTFSAlertsURL)
	if err != nil {
		return nil, err
	}

	var alerts []ParsedAlert
	for _, entity := range feed.Entity {
		if entity.Alert == nil || entity.Id == nil {
			continue
		}

		alert := entity.Alert
		parsed := ParsedAlert{
			AlertID: *entity.Id,
		}

		// Cause
		if alert.Cause != nil {
			if cause, ok := CauseMap[int32(*alert.Cause)]; ok {
				parsed.Cause = cause
			}
		}

		// Effect
		if alert.Effect != nil {
			if effect, ok := EffectMap[int32(*alert.Effect)]; ok {
				parsed.Effect = effect
			}
		}

		// Active periods (use first one if multiple)
		if len(alert.ActivePeriod) > 0 {
			period := alert.ActivePeriod[0]
			if period.Start != nil {
				t := time.Unix(int64(*period.Start), 0).UTC()
				parsed.ActivePeriodStart = &t
			}
			if period.End != nil {
				t := time.Unix(int64(*period.End), 0).UTC()
				parsed.ActivePeriodEnd = &t
			}
		}

		// Description text - extract by language
		if alert.DescriptionText != nil {
			for _, translation := range alert.DescriptionText.Translation {
				if translation.Text == nil {
					continue
				}
				lang := ""
				if translation.Language != nil {
					lang = *translation.Language
				}
				switch lang {
				case "es":
					parsed.DescriptionES = *translation.Text
				case "ca":
					parsed.DescriptionCA = *translation.Text
				case "en":
					parsed.DescriptionEN = *translation.Text
				default:
					// If no language specified, use as Spanish fallback
					if parsed.DescriptionES == "" {
						parsed.DescriptionES = *translation.Text
					}
				}
			}
		}

		// Informed entities (affected routes/stops/trips)
		for _, ie := range alert.InformedEntity {
			entity := AlertEntity{}
			if ie.RouteId != nil {
				entity.RouteID = *ie.RouteId
			}
			if ie.StopId != nil {
				entity.StopID = *ie.StopId
			}
			if ie.Trip != nil && ie.Trip.TripId != nil {
				entity.TripID = *ie.Trip.TripId
			}
			parsed.Entities = append(parsed.Entities, entity)
		}

		// Only keep alerts that affect at least one Rodalies route
		if isRodaliesAlert(parsed) {
			alerts = append(alerts, parsed)
		}
	}

	return alerts, nil
}

// isRodaliesAlert returns true if any informed entity references a Rodalies route.
func isRodaliesAlert(a ParsedAlert) bool {
	for _, e := range a.Entities {
		if e.RouteID != "" && rodaliesRouteRegex.MatchString(e.RouteID) {
			return true
		}
	}
	return false
}

// pollAlerts fetches alerts and stores them in the database
func (p *Poller) pollAlerts(ctx context.Context) error {
	alerts, err := p.fetchAlerts(ctx)
	if err != nil {
		return err
	}

	now := time.Now().UTC()

	// Convert to DB alerts
	dbAlerts := make([]db.Alert, 0, len(alerts))
	for _, a := range alerts {
		dbAlert := db.Alert{
			AlertID:       a.AlertID,
			Cause:         a.Cause,
			Effect:        a.Effect,
			DescriptionES: a.DescriptionES,
			DescriptionCA: a.DescriptionCA,
			DescriptionEN: a.DescriptionEN,
			LastSeenAt:    now,
		}
		if a.ActivePeriodStart != nil {
			s := a.ActivePeriodStart.Format(time.RFC3339)
			dbAlert.ActivePeriodStart = &s
		}
		if a.ActivePeriodEnd != nil {
			s := a.ActivePeriodEnd.Format(time.RFC3339)
			dbAlert.ActivePeriodEnd = &s
		}
		for _, e := range a.Entities {
			dbAlert.Entities = append(dbAlert.Entities, db.AlertEntity{
				RouteID: e.RouteID,
				StopID:  e.StopID,
				TripID:  e.TripID,
			})
		}
		dbAlerts = append(dbAlerts, dbAlert)
	}

	// Upsert alerts
	if err := p.db.UpsertAlerts(ctx, dbAlerts); err != nil {
		return err
	}

	// Mark resolved: collect active IDs and mark any not in feed as resolved
	activeIDs := make([]string, 0, len(alerts))
	for _, a := range alerts {
		activeIDs = append(activeIDs, a.AlertID)
	}
	if err := p.db.MarkResolvedAlerts(ctx, activeIDs); err != nil {
		return err
	}

	log.Printf("Rodalies: polled %d alerts", len(alerts))
	return nil
}
