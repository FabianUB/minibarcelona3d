package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/you/myapp/apps/api/models"
)

// MetroRepository defines the interface for Metro data operations
type MetroRepository interface {
	GetAllMetroPositions(ctx context.Context) ([]models.MetroPosition, error)
	GetMetroPositionsByLine(ctx context.Context, lineCode string) ([]models.MetroPosition, error)
	GetMetroPositionsWithHistory(ctx context.Context, lineCode string) ([]models.MetroPosition, []models.MetroPosition, time.Time, *time.Time, error)
}

// MetroHandler handles HTTP requests for Metro vehicle position data
type MetroHandler struct {
	repo MetroRepository
}

// NewMetroHandler creates a new handler with the given repository
func NewMetroHandler(repo MetroRepository) *MetroHandler {
	return &MetroHandler{repo: repo}
}

// GetAllMetroPositionsResponse is the JSON response structure for GET /api/metro/positions
type GetAllMetroPositionsResponse struct {
	Positions         []models.MetroPosition `json:"positions"`
	PreviousPositions []models.MetroPosition `json:"previousPositions,omitempty"`
	Count             int                    `json:"count"`
	PolledAt          time.Time              `json:"polledAt"`
	PreviousPolledAt  *time.Time             `json:"previousPolledAt,omitempty"`
}

// GetAllMetroPositions handles GET /api/metro/positions
// Returns lightweight position data optimized for frequent polling (every 30s)
// Performance target: <50ms for ~150 vehicles
func (h *MetroHandler) GetAllMetroPositions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	lineCode := r.URL.Query().Get("line_code") // Optional line filter

	positions, previousPositions, polledAt, previousPolledAt, err := h.repo.GetMetroPositionsWithHistory(ctx, lineCode)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Failed to retrieve metro positions",
			Details: map[string]interface{}{
				"internal": err.Error(),
			},
		})
		return
	}

	// Build response
	response := GetAllMetroPositionsResponse{
		Positions: positions,
		Count:     len(positions),
		PolledAt:  polledAt,
	}

	if len(previousPositions) > 0 && previousPolledAt != nil {
		response.PreviousPositions = previousPositions
		response.PreviousPolledAt = previousPolledAt
	}

	// Cache for 15 seconds with stale-while-revalidate for smooth updates
	// (half of 30s polling interval to ensure freshness)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=15, stale-while-revalidate=10")
	w.Header().Set("Vary", "Accept-Encoding")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// GetMetroByLine handles GET /api/metro/lines/{lineCode}
// Returns positions for a specific Metro line (L1, L2, L3, etc.)
func (h *MetroHandler) GetMetroByLine(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	lineCode := chi.URLParam(r, "lineCode")

	if lineCode == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "lineCode parameter is required",
		})
		return
	}

	positions, previousPositions, polledAt, previousPolledAt, err := h.repo.GetMetroPositionsWithHistory(ctx, lineCode)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Failed to retrieve metro positions for line",
			Details: map[string]interface{}{
				"lineCode": lineCode,
				"internal": err.Error(),
			},
		})
		return
	}

	// Build response
	response := GetAllMetroPositionsResponse{
		Positions: positions,
		Count:     len(positions),
		PolledAt:  polledAt,
	}

	if len(previousPositions) > 0 && previousPolledAt != nil {
		response.PreviousPositions = previousPositions
		response.PreviousPolledAt = previousPolledAt
	}

	// Cache for 15 seconds
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=15, stale-while-revalidate=10")
	w.Header().Set("Vary", "Accept-Encoding")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}
