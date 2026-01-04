package schedule

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Queries handles database queries for schedule-based estimation
type Queries struct {
	db *sql.DB
}

// NewQueries creates a new Queries instance
func NewQueries(db *sql.DB) *Queries {
	return &Queries{db: db}
}

// GetActiveTrips returns trips currently in progress for a given network
func (q *Queries) GetActiveTrips(ctx context.Context, network string, currentSeconds int, today string, dayOfWeek int) ([]ActiveTrip, error) {
	// Query trips that are in progress based on:
	// 1. First departure <= currentSeconds <= last arrival
	// 2. Service is active today (calendar pattern or calendar_dates exception)
	query := `
		WITH trip_bounds AS (
			SELECT
				st.trip_id,
				MIN(st.departure_seconds) as first_departure,
				MAX(st.arrival_seconds) as last_arrival
			FROM dim_stop_times st
			WHERE st.network = ?
			GROUP BY st.trip_id
		),
		active_services AS (
			-- Regular calendar services
			SELECT DISTINCT c.service_id
			FROM dim_calendar c
			WHERE c.network = ?
			  AND c.start_date <= ?
			  AND c.end_date >= ?
			  AND (
				(? = 0 AND c.sunday = 1) OR
				(? = 1 AND c.monday = 1) OR
				(? = 2 AND c.tuesday = 1) OR
				(? = 3 AND c.wednesday = 1) OR
				(? = 4 AND c.thursday = 1) OR
				(? = 5 AND c.friday = 1) OR
				(? = 6 AND c.saturday = 1)
			  )
			  -- Exclude services removed today
			  AND c.service_id NOT IN (
				SELECT cd.service_id FROM dim_calendar_dates cd
				WHERE cd.network = ? AND cd.date = ? AND cd.exception_type = 2
			  )
			UNION
			-- Added services from calendar_dates
			SELECT cd.service_id
			FROM dim_calendar_dates cd
			WHERE cd.network = ? AND cd.date = ? AND cd.exception_type = 1
		)
		SELECT
			t.trip_id,
			t.route_id,
			t.service_id,
			COALESCE(t.direction_id, 0) as direction_id,
			COALESCE(t.trip_headsign, '') as trip_headsign,
			COALESCE(r.route_short_name, '') as route_short_name,
			COALESCE(r.route_color, 'CCCCCC') as route_color,
			COALESCE(r.route_type, 3) as route_type,
			tb.first_departure,
			tb.last_arrival
		FROM dim_trips t
		JOIN trip_bounds tb ON t.trip_id = tb.trip_id
		JOIN active_services asvc ON t.service_id = asvc.service_id
		LEFT JOIN dim_routes r ON t.route_id = r.route_id AND r.network = ?
		WHERE t.network = ?
		  AND tb.first_departure <= ?
		  AND tb.last_arrival >= ?
	`

	rows, err := q.db.QueryContext(ctx, query,
		network,                                                         // trip_bounds
		network, today, today,                                           // calendar dates check
		dayOfWeek, dayOfWeek, dayOfWeek, dayOfWeek, dayOfWeek, dayOfWeek, dayOfWeek, // day checks
		network, today, // calendar_dates exclusion
		network, today, // calendar_dates addition
		network, network, // final joins
		currentSeconds, currentSeconds, // time bounds
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query active trips: %w", err)
	}
	defer rows.Close()

	var trips []ActiveTrip
	for rows.Next() {
		var trip ActiveTrip
		if err := rows.Scan(
			&trip.TripID,
			&trip.RouteID,
			&trip.ServiceID,
			&trip.DirectionID,
			&trip.TripHeadsign,
			&trip.RouteShortName,
			&trip.RouteColor,
			&trip.RouteType,
			&trip.FirstDeparture,
			&trip.LastArrival,
		); err != nil {
			return nil, fmt.Errorf("failed to scan trip: %w", err)
		}
		trip.NetworkType = routeTypeToNetwork(trip.RouteType)
		trips = append(trips, trip)
	}

	return trips, rows.Err()
}

// GetTripStopTimes returns all stop times for a trip, ordered by sequence
func (q *Queries) GetTripStopTimes(ctx context.Context, tripID string) ([]TripStopTime, error) {
	query := `
		SELECT
			st.trip_id,
			st.stop_id,
			COALESCE(s.stop_name, '') as stop_name,
			COALESCE(s.stop_lat, 0) as stop_lat,
			COALESCE(s.stop_lon, 0) as stop_lon,
			st.stop_sequence,
			st.arrival_seconds,
			st.departure_seconds
		FROM dim_stop_times st
		LEFT JOIN dim_stops s ON st.stop_id = s.stop_id
		WHERE st.trip_id = ?
		ORDER BY st.stop_sequence
	`

	rows, err := q.db.QueryContext(ctx, query, tripID)
	if err != nil {
		return nil, fmt.Errorf("failed to query stop times: %w", err)
	}
	defer rows.Close()

	var stopTimes []TripStopTime
	for rows.Next() {
		var st TripStopTime
		if err := rows.Scan(
			&st.TripID,
			&st.StopID,
			&st.StopName,
			&st.StopLat,
			&st.StopLon,
			&st.StopSequence,
			&st.ArrivalSeconds,
			&st.DepartureSeconds,
		); err != nil {
			return nil, fmt.Errorf("failed to scan stop time: %w", err)
		}
		stopTimes = append(stopTimes, st)
	}

	return stopTimes, rows.Err()
}

// routeTypeToNetwork maps GTFS route_type to our network identifier
func routeTypeToNetwork(routeType int) string {
	switch routeType {
	case RouteTypeTram:
		return NetworkTram
	case RouteTypeFunicular, RouteTypeSubway:
		// FGC uses funicular and some subway types
		return NetworkFGC
	case RouteTypeBus, RouteTypeTrolleybus:
		return NetworkBus
	default:
		return NetworkBus
	}
}

// SecondsSinceMidnight returns the number of seconds since midnight for the given time
func SecondsSinceMidnight(t time.Time) int {
	return t.Hour()*3600 + t.Minute()*60 + t.Second()
}

// FormatTimeHHMMSS converts seconds since midnight to HH:MM:SS format
func FormatTimeHHMMSS(seconds int) string {
	h := seconds / 3600
	m := (seconds % 3600) / 60
	s := seconds % 60
	return fmt.Sprintf("%02d:%02d:%02d", h, m, s)
}
