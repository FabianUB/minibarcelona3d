package rodalies

import (
	"testing"

	"github.com/mini-rodalies-3d/poller/internal/static/gtfs"
)

// TestComputeViewportBarcelona ensures the viewport is always centered on Barcelona.
// This test exists because the Renfe GTFS data covers ALL of Spain's Cercanías networks,
// but this app is specifically for Barcelona. Without this test, it's easy to accidentally
// regenerate the manifest with a viewport centered on central Spain.
func TestComputeViewportBarcelona(t *testing.T) {
	// Test with empty stops - should still return Barcelona
	viewport := computeViewport(nil)
	assertBarcelonaViewport(t, viewport)

	// Test with stops from Madrid area - should still return Barcelona
	madridStops := []gtfs.Stop{
		{StopID: "1", StopLat: 40.4168, StopLon: -3.7038}, // Madrid
		{StopID: "2", StopLat: 40.4000, StopLon: -3.6800},
	}
	viewport = computeViewport(madridStops)
	assertBarcelonaViewport(t, viewport)

	// Test with stops from Valencia - should still return Barcelona
	valenciaStops := []gtfs.Stop{
		{StopID: "1", StopLat: 39.4699, StopLon: -0.3763}, // Valencia
	}
	viewport = computeViewport(valenciaStops)
	assertBarcelonaViewport(t, viewport)
}

// TestBuildRouteToLineMappingFiltersNonCatalunya verifies that routes from
// other Spanish Cercanías networks (C1-C10, T1, etc.) are excluded from
// the mapping while Catalunya lines (R1, R2, RT1, etc.) are kept.
func TestBuildRouteToLineMappingFiltersNonCatalunya(t *testing.T) {
	routes := []gtfs.Route{
		{RouteID: "route-c1", RouteShortName: "C1"},   // Madrid Cercanías
		{RouteID: "route-c2", RouteShortName: "C2"},   // Madrid Cercanías
		{RouteID: "route-t1", RouteShortName: "T1"},   // Non-Catalunya tram
		{RouteID: "route-r1", RouteShortName: "R1"},   // Catalunya
		{RouteID: "route-r2", RouteShortName: "R2"},   // Catalunya
		{RouteID: "route-rt1", RouteShortName: "RT1"}, // Catalunya
		{RouteID: "route-empty", RouteShortName: ""},   // No code
	}

	mapping := buildRouteToLineMapping(routes)

	// Catalunya lines must be present
	for _, want := range []struct{ routeID, lineCode string }{
		{"route-r1", "R1"},
		{"route-r2", "R2"},
		{"route-rt1", "RT1"},
	} {
		got, ok := mapping[want.routeID]
		if !ok {
			t.Errorf("expected route %s to map to %s, but it was excluded", want.routeID, want.lineCode)
		} else if got != want.lineCode {
			t.Errorf("route %s mapped to %q, want %q", want.routeID, got, want.lineCode)
		}
	}

	// Non-Catalunya lines must be excluded
	for _, routeID := range []string{"route-c1", "route-c2", "route-t1", "route-empty"} {
		if code, ok := mapping[routeID]; ok {
			t.Errorf("route %s should be filtered out, but mapped to %q", routeID, code)
		}
	}

	if len(mapping) != 3 {
		t.Errorf("expected 3 mappings (R1, R2, RT1), got %d: %v", len(mapping), mapping)
	}
}

func assertBarcelonaViewport(t *testing.T, viewport MapViewport) {
	t.Helper()

	// Barcelona coordinates (approximately)
	const (
		expectedLat    = 41.3896
		expectedLng    = 2.170302
		tolerance      = 0.1 // Allow small variations
	)

	// Check center is Barcelona, not somewhere else in Spain
	if viewport.Center.Lat < 41.0 || viewport.Center.Lat > 42.0 {
		t.Errorf("Viewport center latitude %f is NOT in Barcelona area (expected ~41.39). "+
			"Did you accidentally compute viewport from all-Spain data?", viewport.Center.Lat)
	}

	if viewport.Center.Lng < 1.5 || viewport.Center.Lng > 2.5 {
		t.Errorf("Viewport center longitude %f is NOT in Barcelona area (expected ~2.17). "+
			"Did you accidentally compute viewport from all-Spain data?", viewport.Center.Lng)
	}

	// Check specific expected values
	if viewport.Center.Lat != expectedLat {
		t.Errorf("Viewport center lat = %f, want %f", viewport.Center.Lat, expectedLat)
	}
	if viewport.Center.Lng != expectedLng {
		t.Errorf("Viewport center lng = %f, want %f", viewport.Center.Lng, expectedLng)
	}

	// Check zoom
	if viewport.Zoom != 13.48 {
		t.Errorf("Viewport zoom = %f, want 13.48", viewport.Zoom)
	}

	// Check bounds are Catalonia, not all of Spain
	if len(viewport.MaxBounds) != 2 {
		t.Fatalf("MaxBounds should have 2 points, got %d", len(viewport.MaxBounds))
	}

	// Southwest bound should be around [0.25, 40.4] (Catalonia SW)
	// NOT [-9.37, 35.68] (Spain SW including Portugal border)
	swLng, swLat := viewport.MaxBounds[0][0], viewport.MaxBounds[0][1]
	if swLng < -1.0 {
		t.Errorf("SW bound longitude %f suggests all-Spain bounds, not Catalonia", swLng)
	}
	if swLat < 40.0 {
		t.Errorf("SW bound latitude %f suggests all-Spain bounds, not Catalonia", swLat)
	}

	// Northeast bound should be around [3.36, 42.66] (Catalonia NE)
	// NOT [4.30, 44.47] (Spain NE)
	neLng, neLat := viewport.MaxBounds[1][0], viewport.MaxBounds[1][1]
	if neLng > 4.0 {
		t.Errorf("NE bound longitude %f suggests all-Spain bounds, not Catalonia", neLng)
	}
	if neLat > 43.0 {
		t.Errorf("NE bound latitude %f suggests all-Spain bounds, not Catalonia", neLat)
	}
}
