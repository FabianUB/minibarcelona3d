package models

import "time"

// ServiceAlert represents a transit service alert
type ServiceAlert struct {
	AlertID           string   `json:"alertId"`
	Cause             string   `json:"cause,omitempty"`
	Effect            string   `json:"effect,omitempty"`
	DescriptionText   string   `json:"descriptionText"`
	AffectedRoutes    []string `json:"affectedRoutes"`
	IsActive          bool     `json:"isActive"`
	FirstSeenAt       string   `json:"firstSeenAt"`
	ActivePeriodStart *string  `json:"activePeriodStart,omitempty"`
	ActivePeriodEnd   *string  `json:"activePeriodEnd,omitempty"`
	ResolvedAt        *string  `json:"resolvedAt,omitempty"`
}

// DelaySummary represents live delay statistics snapshot
type DelaySummary struct {
	TotalTrains     int     `json:"totalTrains"`
	DelayedTrains   int     `json:"delayedTrains"`
	OnTimePercent   float64 `json:"onTimePercent"`
	AvgDelaySeconds float64 `json:"avgDelaySeconds"`
	MaxDelaySeconds int     `json:"maxDelaySeconds"`
	WorstRoute      string  `json:"worstRoute,omitempty"`
}

// DelayHourlyStat represents hourly delay data for a route
type DelayHourlyStat struct {
	RouteID          string  `json:"routeId"`
	HourBucket       string  `json:"hourBucket"`
	ObservationCount int     `json:"observationCount"`
	MeanDelaySeconds float64 `json:"meanDelaySeconds"`
	StdDevSeconds    float64 `json:"stdDevSeconds"`
	OnTimePercent    float64 `json:"onTimePercent"`
	MaxDelaySeconds  int     `json:"maxDelaySeconds"`
}

// DelayStatsResponse is the response for GET /api/delays/stats
type DelayStatsResponse struct {
	Summary     DelaySummary      `json:"summary"`
	HourlyStats []DelayHourlyStat `json:"hourlyStats"`
	LastChecked time.Time         `json:"lastChecked"`
}

// AlertsResponse is the response for GET /api/alerts
type AlertsResponse struct {
	Alerts      []ServiceAlert `json:"alerts"`
	Count       int            `json:"count"`
	LastChecked time.Time      `json:"lastChecked"`
}
