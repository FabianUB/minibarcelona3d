package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/you/myapp/apps/api/models"
)

// TrainRepository defines the interface for train data operations
type TrainRepository interface {
	GetAllTrains(ctx context.Context) ([]models.Train, error)
	GetTrainByKey(ctx context.Context, vehicleKey string) (*models.Train, error)
	GetTrainsByRoute(ctx context.Context, routeID string) ([]models.Train, error)
	GetAllTrainPositions(ctx context.Context) ([]models.TrainPosition, error)
	GetTrainPositionsWithHistory(ctx context.Context) ([]models.TrainPosition, []models.TrainPosition, time.Time, *time.Time, error)
	GetTripDetails(ctx context.Context, tripID string) (*models.TripDetails, error)
}

// TrainHandler handles HTTP requests for train data
// Implements the API contract defined in contracts/api.yaml
type TrainHandler struct {
	repo TrainRepository
}

// NewTrainHandler creates a new handler with the given repository
func NewTrainHandler(repo TrainRepository) *TrainHandler {
	return &TrainHandler{repo: repo}
}

// GetAllTrainsResponse is the JSON response structure for GET /api/trains
type GetAllTrainsResponse struct {
	Trains   []models.Train `json:"trains"`
	Count    int            `json:"count"`
	PolledAt time.Time      `json:"polledAt"`
}

// GetAllTrainPositionsResponse is the JSON response structure for GET /api/trains/positions
type GetAllTrainPositionsResponse struct {
	Positions         []models.TrainPosition `json:"positions"`
	PreviousPositions []models.TrainPosition `json:"previousPositions,omitempty"`
	Count             int                    `json:"count"`
	PolledAt          time.Time              `json:"polledAt"`
	PreviousPolledAt  *time.Time             `json:"previousPolledAt,omitempty"`
}

// ErrorResponse is the JSON error response structure
type ErrorResponse struct {
	Error   string                 `json:"error"`
	Details map[string]interface{} `json:"details,omitempty"`
}

// GetAllTrains handles GET /api/trains
// Returns all active trains or filters by route_id query parameter
// Performance target: <100ms for ~100 trains
func (h *TrainHandler) GetAllTrains(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	routeID := r.URL.Query().Get("route_id")

	var trains []models.Train
	var err error

	if routeID != "" {
		// Filter by route
		trains, err = h.repo.GetTrainsByRoute(ctx, routeID)
	} else {
		// Get all trains
		trains, err = h.repo.GetAllTrains(ctx)
	}

	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Failed to retrieve trains",
			Details: map[string]interface{}{
				"internal": err.Error(),
			},
		})
		return
	}

	// Build response
	response := GetAllTrainsResponse{
		Trains:   trains,
		Count:    len(trains),
		PolledAt: time.Now().UTC(),
	}

	// T102: Add caching headers for performance
	// Cache for 15 seconds (half of 30s polling interval to ensure freshness)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=15, stale-while-revalidate=10")
	w.Header().Set("Vary", "Accept-Encoding")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// GetTrainByKey handles GET /api/trains/{vehicleKey}
// Returns full details for a specific train by vehicle key
// Performance target: <10ms (primary key lookup)
func (h *TrainHandler) GetTrainByKey(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vehicleKey := chi.URLParam(r, "vehicleKey")

	if vehicleKey == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "vehicleKey parameter is required",
		})
		return
	}

	train, err := h.repo.GetTrainByKey(ctx, vehicleKey)
	if err != nil {
		// Check if it's a "not found" error
		if err.Error() == "train not found: "+vehicleKey {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(ErrorResponse{
				Error: "Train not found",
				Details: map[string]interface{}{
					"vehicleKey": vehicleKey,
				},
			})
			return
		}

		// Internal server error
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Failed to retrieve train",
			Details: map[string]interface{}{
				"internal": err.Error(),
			},
		})
		return
	}

	// T102: Add caching headers for individual train details
	// Cache for 10 seconds for single train lookups
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=10, stale-while-revalidate=5")
	w.Header().Set("Vary", "Accept-Encoding")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(train)
}

// GetAllTrainPositions handles GET /api/trains/positions
// Returns lightweight position data optimized for frequent polling
// Performance target: <50ms for ~100 trains
func (h *TrainHandler) GetAllTrainPositions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	positions, previousPositions, polledAt, previousPolledAt, err := h.repo.GetTrainPositionsWithHistory(ctx)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Failed to retrieve train positions",
			Details: map[string]interface{}{
				"internal": err.Error(),
			},
		})
		return
	}

	// Build response
	response := GetAllTrainPositionsResponse{
		Positions: positions,
		Count:     len(positions),
		PolledAt:  polledAt,
	}

	if len(previousPositions) > 0 && previousPolledAt != nil {
		response.PreviousPositions = previousPositions
		response.PreviousPolledAt = previousPolledAt
	}

	// T102: Add caching headers for position endpoint (most frequently polled)
	// Cache for 15 seconds with stale-while-revalidate for smooth updates
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=15, stale-while-revalidate=10")
	w.Header().Set("Vary", "Accept-Encoding")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

func (h *TrainHandler) GetTripDetails(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tripID := chi.URLParam(r, "tripId")

	if tripID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "tripId parameter is required",
		})
		return
	}

	tripDetails, err := h.repo.GetTripDetails(ctx, tripID)
	if err != nil {
		if err.Error() == "trip not found" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(ErrorResponse{
				Error: "Trip not found",
				Details: map[string]interface{}{
					"tripId": tripID,
				},
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Failed to retrieve trip details",
			Details: map[string]interface{}{
				"internal": err.Error(),
			},
		})
		return
	}

	// T102: Add caching headers for trip details
	// Trip details include real-time delay data, cache for 15 seconds like positions
	// This ensures delay calculations remain accurate while reducing load
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=15, stale-while-revalidate=10")
	w.Header().Set("Vary", "Accept-Encoding")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(tripDetails)
}
