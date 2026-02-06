package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/you/myapp/apps/api/models"
)

// DelayRepository defines the interface for delay/alert operations
type DelayRepository interface {
	GetActiveAlerts(ctx context.Context, routeID string, lang string) ([]models.ServiceAlert, error)
	GetCurrentDelaySummary(ctx context.Context) (*models.DelaySummary, error)
	GetHourlyDelayStats(ctx context.Context, routeID string, hours int) ([]models.DelayHourlyStat, error)
}

// DelayHandler handles HTTP requests for delay and alert data
type DelayHandler struct {
	repo DelayRepository
}

// NewDelayHandler creates a new handler with the given repository
func NewDelayHandler(repo DelayRepository) *DelayHandler {
	return &DelayHandler{repo: repo}
}

// GetAlerts handles GET /api/alerts
// Query params: route_id (optional), lang (optional, default "es")
func (h *DelayHandler) GetAlerts(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	routeID := r.URL.Query().Get("route_id")
	lang := r.URL.Query().Get("lang")
	if lang == "" {
		lang = "es"
	}

	alerts, err := h.repo.GetActiveAlerts(ctx, routeID, lang)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Failed to get alerts",
		})
		return
	}

	response := models.AlertsResponse{
		Alerts:      alerts,
		Count:       len(alerts),
		LastChecked: time.Now().UTC(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// GetDelayStats handles GET /api/delays/stats
// Query params: route_id (optional), period (optional, default "24h")
func (h *DelayHandler) GetDelayStats(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	routeID := r.URL.Query().Get("route_id")

	// Parse period (default 24h)
	periodStr := r.URL.Query().Get("period")
	hours := 24
	if periodStr != "" {
		// Support formats like "24h", "48h", "168h" (1 week)
		if len(periodStr) > 1 && periodStr[len(periodStr)-1] == 'h' {
			if h, err := strconv.Atoi(periodStr[:len(periodStr)-1]); err == nil && h > 0 && h <= 720 {
				hours = h
			}
		}
	}

	// Get live summary
	summary, err := h.repo.GetCurrentDelaySummary(ctx)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Failed to get delay summary",
		})
		return
	}

	// Get hourly historical stats
	hourlyStats, err := h.repo.GetHourlyDelayStats(ctx, routeID, hours)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Failed to get hourly delay stats",
		})
		return
	}

	response := models.DelayStatsResponse{
		Summary:     *summary,
		HourlyStats: hourlyStats,
		LastChecked: time.Now().UTC(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}
