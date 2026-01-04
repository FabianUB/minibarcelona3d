package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/you/myapp/apps/api/models"
)

// ScheduleRepository defines the interface for Schedule data operations
type ScheduleRepository interface {
	GetAllSchedulePositions(ctx context.Context) ([]models.SchedulePosition, time.Time, error)
	GetSchedulePositionsByNetwork(ctx context.Context, networkType string) ([]models.SchedulePosition, time.Time, error)
}

// ScheduleHandler handles HTTP requests for schedule-estimated vehicle position data
type ScheduleHandler struct {
	repo ScheduleRepository
}

// NewScheduleHandler creates a new handler with the given repository
func NewScheduleHandler(repo ScheduleRepository) *ScheduleHandler {
	return &ScheduleHandler{repo: repo}
}

// GetAllSchedulePositionsResponse is the JSON response structure for GET /api/transit/schedule
type GetAllSchedulePositionsResponse struct {
	Positions []models.SchedulePosition `json:"positions"`
	Count     int                       `json:"count"`
	Networks  models.NetworkCounts      `json:"networks"`
	PolledAt  time.Time                 `json:"polledAt"`
}

// GetAllSchedulePositions handles GET /api/transit/schedule
// Returns schedule-estimated positions for TRAM, FGC, and Bus
func (h *ScheduleHandler) GetAllSchedulePositions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	networkType := r.URL.Query().Get("network") // Optional network filter: "tram", "fgc", "bus"

	var positions []models.SchedulePosition
	var polledAt time.Time
	var err error

	if networkType != "" {
		positions, polledAt, err = h.repo.GetSchedulePositionsByNetwork(ctx, networkType)
	} else {
		positions, polledAt, err = h.repo.GetAllSchedulePositions(ctx)
	}

	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Failed to retrieve schedule positions",
			Details: map[string]interface{}{
				"internal": err.Error(),
			},
		})
		return
	}

	// Count by network type
	counts := models.NetworkCounts{}
	for _, pos := range positions {
		switch pos.NetworkType {
		case "tram":
			counts.Tram++
		case "fgc":
			counts.FGC++
		case "bus":
			counts.Bus++
		}
	}

	// Build response
	response := GetAllSchedulePositionsResponse{
		Positions: positions,
		Count:     len(positions),
		Networks:  counts,
		PolledAt:  polledAt,
	}

	// Cache for 15 seconds (half of 30s polling interval)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=15, stale-while-revalidate=10")
	w.Header().Set("Vary", "Accept-Encoding")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}
