package integration

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/you/myapp/apps/api/models"
	"github.com/you/myapp/apps/api/repository"
)

func setupTestRepository(t *testing.T) *repository.TrainRepository {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set - skipping integration test")
	}

	repo, err := repository.NewTrainRepository(databaseURL)
	if err != nil {
		t.Fatalf("Failed to create test repository: %v", err)
	}

	return repo
}

func TestGetAllTrains(t *testing.T) {
	repo := setupTestRepository(t)
	defer repo.Close()

	ctx := context.Background()

	trains, err := repo.GetAllTrains(ctx)
	if err != nil {
		t.Fatalf("GetAllTrains failed: %v", err)
	}

	if len(trains) == 0 {
		t.Log("Warning: No trains returned. Database may be empty. Ensure the poller is running.")
		// We don't fail here because an empty database is not necessarily an error
		return
	}

	t.Logf("Successfully retrieved %d trains from database", len(trains))

	firstTrain := trains[0]

	// Required fields must not be empty
	if firstTrain.VehicleKey == "" {
		t.Error("Train VehicleKey is empty")
	}
	if firstTrain.VehicleLabel == "" {
		t.Error("Train VehicleLabel is empty")
	}
	if firstTrain.RouteID == "" {
		t.Error("Train RouteID is empty")
	}
	if firstTrain.Status == "" {
		t.Error("Train Status is empty")
	}

	// Validate geographic coordinates (if present)
	if firstTrain.Latitude != nil {
		if *firstTrain.Latitude < -90 || *firstTrain.Latitude > 90 {
			t.Errorf("Train Latitude out of range: %f", *firstTrain.Latitude)
		}
	} else {
		t.Log("Note: First train has no latitude (NULL in database)")
	}
	if firstTrain.Longitude != nil {
		if *firstTrain.Longitude < -180 || *firstTrain.Longitude > 180 {
			t.Errorf("Train Longitude out of range: %f", *firstTrain.Longitude)
		}
	} else {
		t.Log("Note: First train has no longitude (NULL in database)")
	}

	// Verify timestamps are present
	if firstTrain.PolledAtUTC.IsZero() {
		t.Error("Train PolledAtUTC is zero")
	}
	if firstTrain.UpdatedAt.IsZero() {
		t.Error("Train UpdatedAt is zero")
	}

	// Run model validation
	if err := firstTrain.Validate(); err != nil {
		t.Errorf("Train validation failed: %v", err)
	}

	t.Logf("Sample train: %s (Label: %s, Route: %s, Status: %s)",
		firstTrain.VehicleKey, firstTrain.VehicleLabel, firstTrain.RouteID, firstTrain.Status)
}

func TestGetTrainByKey(t *testing.T) {
	repo := setupTestRepository(t)
	defer repo.Close()

	ctx := context.Background()

	trains, err := repo.GetAllTrains(ctx)
	if err != nil {
		t.Fatalf("Failed to get trains for test setup: %v", err)
	}

	if len(trains) == 0 {
		t.Skip("No trains in database - skipping GetTrainByKey test. Ensure the poller is running.")
	}

	testVehicleKey := trains[0].VehicleKey
	t.Logf("Testing GetTrainByKey with vehicleKey: %s", testVehicleKey)

	train, err := repo.GetTrainByKey(ctx, testVehicleKey)
	if err != nil {
		t.Fatalf("GetTrainByKey failed: %v", err)
	}

	if train == nil {
		t.Fatal("GetTrainByKey returned nil train")
	}

	if train.VehicleKey != testVehicleKey {
		t.Errorf("Expected VehicleKey %s, got %s", testVehicleKey, train.VehicleKey)
	}

	if train.VehicleLabel == "" {
		t.Error("Train VehicleLabel is empty")
	}
	if train.RouteID == "" {
		t.Error("Train RouteID is empty")
	}

	if err := train.Validate(); err != nil {
		t.Errorf("Train validation failed: %v", err)
	}

	nonExistentKey := "vehicle:NONEXISTENT999"
	_, err = repo.GetTrainByKey(ctx, nonExistentKey)
	if err == nil {
		t.Error("Expected error when querying non-existent train, got nil")
	}

	t.Logf("GetTrainByKey test passed for vehicle: %s", testVehicleKey)
}

func TestGetAllTrainsPerformance(t *testing.T) {
	repo := setupTestRepository(t)
	defer repo.Close()

	ctx := context.Background()

	_, err := repo.GetAllTrains(ctx)
	if err != nil {
		t.Fatalf("Warm-up query failed: %v", err)
	}

	const iterations = 5
	var totalDuration time.Duration

	for i := 0; i < iterations; i++ {
		start := time.Now()
		trains, err := repo.GetAllTrains(ctx)
		duration := time.Since(start)
		totalDuration += duration

		if err != nil {
			t.Fatalf("Performance test query %d failed: %v", i+1, err)
		}

		t.Logf("Query %d: %d trains retrieved in %v", i+1, len(trains), duration)

		if duration > 100*time.Millisecond {
			t.Logf("Warning: Query %d exceeded 100ms target: %v", i+1, duration)
		}
	}

	avgDuration := totalDuration / iterations
	t.Logf("Average query time over %d iterations: %v", iterations, avgDuration)

	if avgDuration > 100*time.Millisecond {
		t.Errorf("PERFORMANCE: Average query time %v exceeds 100ms target", avgDuration)
	} else {
		t.Logf("✓ Performance target met: %v < 100ms", avgDuration)
	}
}

func TestGetTrainsByRoute(t *testing.T) {
	repo := setupTestRepository(t)
	defer repo.Close()

	ctx := context.Background()

	// First, get all trains to find a valid route ID
	allTrains, err := repo.GetAllTrains(ctx)
	if err != nil {
		t.Fatalf("Failed to get all trains: %v", err)
	}

	if len(allTrains) == 0 {
		t.Skip("No trains in database - skipping route filter test")
	}

	// Use the first train's route ID for testing
	testRouteID := allTrains[0].RouteID
	t.Logf("Testing GetTrainsByRoute with routeID: %s", testRouteID)

	// Get trains filtered by route
	routeTrains, err := repo.GetTrainsByRoute(ctx, testRouteID)
	if err != nil {
		t.Fatalf("GetTrainsByRoute failed: %v", err)
	}

	if len(routeTrains) == 0 {
		t.Errorf("Expected trains for route %s, got 0", testRouteID)
	}

	// Verify all returned trains have the correct route ID
	for i, train := range routeTrains {
		if train.RouteID != testRouteID {
			t.Errorf("Train %d has wrong RouteID: expected %s, got %s", i, testRouteID, train.RouteID)
		}
	}

	t.Logf("GetTrainsByRoute returned %d trains for route %s", len(routeTrains), testRouteID)
}

func TestGetAllTrainPositions(t *testing.T) {
	repo := setupTestRepository(t)
	defer repo.Close()

	ctx := context.Background()

	start := time.Now()
	positions, err := repo.GetAllTrainPositions(ctx)
	duration := time.Since(start)

	if err != nil {
		t.Fatalf("GetAllTrainPositions failed: %v", err)
	}

	if len(positions) == 0 {
		t.Log("Warning: No train positions returned. Database may be empty.")
		return
	}

	t.Logf("Retrieved %d train positions in %v", len(positions), duration)

	// Verify the first position has required fields
	firstPos := positions[0]
	if firstPos.VehicleKey == "" {
		t.Error("Position VehicleKey is empty")
	}
	if firstPos.RouteID == "" {
		t.Error("Position RouteID is empty")
	}
	if firstPos.Status == "" {
		t.Error("Position Status is empty")
	}

	// Performance target: <50ms for ~100 trains (lighter than full query)
	if duration > 50*time.Millisecond {
		t.Logf("Warning: Position query %v exceeds 50ms target", duration)
	} else {
		t.Logf("✓ Position query performance: %v < 50ms", duration)
	}

	if firstPos.Latitude != nil && firstPos.Longitude != nil {
		t.Logf("Sample position: %s at (%.4f, %.4f)",
			firstPos.VehicleKey, *firstPos.Latitude, *firstPos.Longitude)
	} else {
		t.Logf("Sample position: %s (no GPS coordinates)", firstPos.VehicleKey)
	}
}

func TestDatabaseConnection(t *testing.T) {
	repo := setupTestRepository(t)
	defer repo.Close()

	// If we got here without errors, the connection is working
	t.Log("✓ Database connection successful")
}

func TestTrainModelValidation(t *testing.T) {
	// Helper to create float64 pointer
	float64Ptr := func(f float64) *float64 { return &f }

	tests := []struct {
		name      string
		train     models.Train
		wantError bool
	}{
		{
			name: "valid train with GPS",
			train: models.Train{
				VehicleKey:   "vehicle:R12345",
				VehicleLabel: "R12345",
				RouteID:      "R1",
				Latitude:     float64Ptr(41.3851),
				Longitude:    float64Ptr(2.1734),
				Status:       "IN_TRANSIT_TO",
			},
			wantError: false,
		},
		{
			name: "valid train without GPS (nil coordinates)",
			train: models.Train{
				VehicleKey:   "vehicle:R12345",
				VehicleLabel: "R12345",
				RouteID:      "R1",
				Latitude:     nil,
				Longitude:    nil,
				Status:       "IN_TRANSIT_TO",
			},
			wantError: false,
		},
		{
			name: "missing vehicle key",
			train: models.Train{
				VehicleLabel: "R12345",
				RouteID:      "R1",
				Latitude:     float64Ptr(41.3851),
				Longitude:    float64Ptr(2.1734),
				Status:       "IN_TRANSIT_TO",
			},
			wantError: true,
		},
		{
			name: "invalid vehicle label (not starting with R)",
			train: models.Train{
				VehicleKey:   "vehicle:X12345",
				VehicleLabel: "X12345",
				RouteID:      "R1",
				Latitude:     float64Ptr(41.3851),
				Longitude:    float64Ptr(2.1734),
				Status:       "IN_TRANSIT_TO",
			},
			wantError: true,
		},
		{
			name: "latitude out of range",
			train: models.Train{
				VehicleKey:   "vehicle:R12345",
				VehicleLabel: "R12345",
				RouteID:      "R1",
				Latitude:     float64Ptr(100.0),
				Longitude:    float64Ptr(2.1734),
				Status:       "IN_TRANSIT_TO",
			},
			wantError: true,
		},
		{
			name: "longitude out of range",
			train: models.Train{
				VehicleKey:   "vehicle:R12345",
				VehicleLabel: "R12345",
				RouteID:      "R1",
				Latitude:     float64Ptr(41.3851),
				Longitude:    float64Ptr(200.0),
				Status:       "IN_TRANSIT_TO",
			},
			wantError: true,
		},
		{
			name: "missing route ID",
			train: models.Train{
				VehicleKey:   "vehicle:R12345",
				VehicleLabel: "R12345",
				Latitude:     float64Ptr(41.3851),
				Longitude:    float64Ptr(2.1734),
				Status:       "IN_TRANSIT_TO",
			},
			wantError: true,
		},
		{
			name: "missing status",
			train: models.Train{
				VehicleKey:   "vehicle:R12345",
				VehicleLabel: "R12345",
				RouteID:      "R1",
				Latitude:     float64Ptr(41.3851),
				Longitude:    float64Ptr(2.1734),
			},
			wantError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.train.Validate()
			if (err != nil) != tt.wantError {
				t.Errorf("Validate() error = %v, wantError %v", err, tt.wantError)
			}
			if err != nil {
				t.Logf("Validation error (expected): %v", err)
			}
		})
	}
}
