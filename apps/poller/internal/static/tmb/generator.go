package tmb

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/mini-rodalies-3d/poller/internal/static/gtfs"
)

// MetroLineColorMap contains official TMB Metro colors
var MetroLineColorMap = map[string]string{
	"L1":   "#CE1126",
	"L2":   "#9B3A97",
	"L3":   "#1EB53A",
	"L4":   "#F9B233",
	"L5":   "#0078C6",
	"L9N":  "#F58220",
	"L9S":  "#F58220",
	"L10N": "#00A9E0",
	"L10S": "#00A9E0",
	"L11":  "#A5D867",
	"FM":   "#A5D867", // Funicular de Montjuïc
}

// RouteType constants from GTFS
const (
	RouteTypeTram       = 0
	RouteTypeMetro      = 1
	RouteTypeRail       = 2
	RouteTypeBus        = 3
	RouteTypeFerry      = 4
	RouteTypeCableCar   = 5
	RouteTypeSuspended  = 6
	RouteTypeFunicular  = 7
)

// Generate creates TMB GeoJSON files from GTFS data
func Generate(data *gtfs.Data, outputDir string) error {
	// Create output directories
	metroDir := filepath.Join(outputDir, "metro")
	metroLinesDir := filepath.Join(metroDir, "lines")
	busDir := filepath.Join(outputDir, "bus")
	busRoutesDir := filepath.Join(busDir, "routes")

	for _, dir := range []string{metroLinesDir, busRoutesDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", dir, err)
		}
	}

	now := time.Now().UTC()
	nowStr := now.Format(time.RFC3339)

	// Separate routes by type
	metroRoutes := filterRoutesByType(data.Routes, RouteTypeMetro)
	funicularRoutes := filterRoutesByType(data.Routes, RouteTypeFunicular)
	busRoutes := filterRoutesByType(data.Routes, RouteTypeBus)

	// Combine metro and funicular
	metroRoutes = append(metroRoutes, funicularRoutes...)

	// Build route mappings
	routeToLine := buildRouteToLineMapping(metroRoutes)
	stopToLines := buildStopToLinesMapping(data.Trips, data.StopTimes, routeToLine)

	// Generate metro line files
	if err := generateMetroLineFiles(data, metroRoutes, routeToLine, metroLinesDir, nowStr); err != nil {
		return fmt.Errorf("failed to generate metro lines: %w", err)
	}

	// Generate metro stations
	if err := generateMetroStations(data.Stops, stopToLines, metroDir); err != nil {
		return fmt.Errorf("failed to generate metro stations: %w", err)
	}

	// Generate funicular stations separately
	funicularRouteToLine := buildRouteToLineMapping(funicularRoutes)
	funicularStopToLines := buildStopToLinesMapping(data.Trips, data.StopTimes, funicularRouteToLine)
	if err := generateFunicularStations(data.Stops, funicularStopToLines, metroDir); err != nil {
		log.Printf("Warning: failed to generate funicular stations: %v", err)
	}

	// Generate bus data
	busRouteToLine := buildRouteToLineMapping(busRoutes)
	busStopToLines := buildStopToLinesMapping(data.Trips, data.StopTimes, busRouteToLine)

	if err := generateBusRouteFiles(data, busRoutes, busRouteToLine, busRoutesDir, nowStr); err != nil {
		log.Printf("Warning: failed to generate bus routes: %v", err)
	}

	if err := generateBusStops(data.Stops, busStopToLines, busDir); err != nil {
		log.Printf("Warning: failed to generate bus stops: %v", err)
	}

	// Generate manifest
	if err := generateTMBManifest(outputDir, nowStr); err != nil {
		return fmt.Errorf("failed to generate manifest: %w", err)
	}

	log.Printf("TMB: generated %d metro routes, %d bus routes", len(metroRoutes), len(busRoutes))
	return nil
}

func filterRoutesByType(routes []gtfs.Route, routeType int) []gtfs.Route {
	var filtered []gtfs.Route
	for _, route := range routes {
		if route.RouteType == routeType {
			filtered = append(filtered, route)
		}
	}
	return filtered
}

func buildRouteToLineMapping(routes []gtfs.Route) map[string]string {
	mapping := make(map[string]string)
	for _, route := range routes {
		lineCode := route.RouteShortName
		if lineCode == "" {
			lineCode = route.RouteID
		}
		mapping[route.RouteID] = lineCode
	}
	return mapping
}

func buildStopToLinesMapping(trips []gtfs.Trip, stopTimes []gtfs.StopTime, routeToLine map[string]string) map[string]map[string]bool {
	tripToLine := make(map[string]string)
	for _, trip := range trips {
		if line, ok := routeToLine[trip.RouteID]; ok {
			tripToLine[trip.TripID] = line
		}
	}

	stopToLines := make(map[string]map[string]bool)
	for _, st := range stopTimes {
		if line, ok := tripToLine[st.TripID]; ok {
			if stopToLines[st.StopID] == nil {
				stopToLines[st.StopID] = make(map[string]bool)
			}
			stopToLines[st.StopID][line] = true
		}
	}

	return stopToLines
}

func generateMetroLineFiles(data *gtfs.Data, routes []gtfs.Route, routeToLine map[string]string, linesDir, nowStr string) error {
	lineShapes := make(map[string][][2]float64)
	lineColors := make(map[string]string)

	for _, route := range routes {
		lineCode := routeToLine[route.RouteID]
		if route.RouteColor != "" {
			lineColors[lineCode] = "#" + route.RouteColor
		}
	}

	for _, trip := range data.Trips {
		lineCode, ok := routeToLine[trip.RouteID]
		if !ok || trip.ShapeID == "" {
			continue
		}

		shapePoints, ok := data.Shapes[trip.ShapeID]
		if !ok {
			continue
		}

		coords := make([][2]float64, len(shapePoints))
		for i, sp := range shapePoints {
			coords[i] = [2]float64{sp.ShapePtLon, sp.ShapePtLat}
		}

		if existing, ok := lineShapes[lineCode]; !ok || len(coords) > len(existing) {
			lineShapes[lineCode] = coords
		}
	}

	var sortedLines []string
	for lineCode := range lineShapes {
		sortedLines = append(sortedLines, lineCode)
	}
	sort.Strings(sortedLines)

	for _, lineCode := range sortedLines {
		coords := lineShapes[lineCode]
		if len(coords) < 2 {
			continue
		}

		color := lineColors[lineCode]
		if color == "" {
			if c, ok := MetroLineColorMap[lineCode]; ok {
				color = c
			} else {
				color = "#888888"
			}
		}

		feature := map[string]interface{}{
			"type": "FeatureCollection",
			"features": []map[string]interface{}{
				{
					"type": "Feature",
					"geometry": map[string]interface{}{
						"type":        "LineString",
						"coordinates": coords,
					},
					"properties": map[string]interface{}{
						"line_code":        lineCode,
						"color":            color,
						"last_verified_at": nowStr,
					},
				},
			},
		}

		data, err := json.MarshalIndent(feature, "", "  ")
		if err != nil {
			return err
		}

		if err := os.WriteFile(filepath.Join(linesDir, lineCode+".geojson"), data, 0644); err != nil {
			return err
		}
	}

	return nil
}

func generateMetroStations(stops []gtfs.Stop, stopToLines map[string]map[string]bool, metroDir string) error {
	type StationFeature struct {
		Type       string                 `json:"type"`
		Geometry   map[string]interface{} `json:"geometry"`
		Properties map[string]interface{} `json:"properties"`
	}

	var features []StationFeature

	for _, stop := range stops {
		if stop.LocationType != 0 && stop.LocationType != 1 {
			continue
		}

		linesMap, ok := stopToLines[stop.StopID]
		if !ok || len(linesMap) == 0 {
			continue
		}

		var lines []string
		var colors []string
		var primaryColor string

		for line := range linesMap {
			lines = append(lines, line)
			if color, ok := MetroLineColorMap[line]; ok {
				colors = append(colors, color)
				if primaryColor == "" {
					primaryColor = color
				}
			}
		}
		sort.Strings(lines)

		if primaryColor == "" {
			primaryColor = "#888888"
		}

		features = append(features, StationFeature{
			Type: "Feature",
			Geometry: map[string]interface{}{
				"type":        "Point",
				"coordinates": [2]float64{stop.StopLon, stop.StopLat},
			},
			Properties: map[string]interface{}{
				"id":            stop.StopID,
				"name":          stop.StopName,
				"stop_code":     stop.StopCode,
				"lines":         lines,
				"primary_color": primaryColor,
				"colors":        colors,
			},
		})
	}

	sort.Slice(features, func(i, j int) bool {
		return features[i].Properties["name"].(string) < features[j].Properties["name"].(string)
	})

	fc := map[string]interface{}{
		"type":     "FeatureCollection",
		"features": features,
	}

	data, err := json.MarshalIndent(fc, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(metroDir, "stations.geojson"), data, 0644)
}

func generateFunicularStations(stops []gtfs.Stop, stopToLines map[string]map[string]bool, metroDir string) error {
	type StationFeature struct {
		Type       string                 `json:"type"`
		Geometry   map[string]interface{} `json:"geometry"`
		Properties map[string]interface{} `json:"properties"`
	}

	var features []StationFeature

	for _, stop := range stops {
		linesMap, ok := stopToLines[stop.StopID]
		if !ok || len(linesMap) == 0 {
			continue
		}

		var lines []string
		for line := range linesMap {
			lines = append(lines, line)
		}
		sort.Strings(lines)

		features = append(features, StationFeature{
			Type: "Feature",
			Geometry: map[string]interface{}{
				"type":        "Point",
				"coordinates": [2]float64{stop.StopLon, stop.StopLat},
			},
			Properties: map[string]interface{}{
				"id":        stop.StopID,
				"name":      stop.StopName,
				"stop_code": stop.StopCode,
				"lines":     lines,
			},
		})
	}

	if len(features) == 0 {
		return nil
	}

	fc := map[string]interface{}{
		"type":     "FeatureCollection",
		"features": features,
	}

	data, err := json.MarshalIndent(fc, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(metroDir, "funicular_stations.geojson"), data, 0644)
}

func generateBusRouteFiles(data *gtfs.Data, routes []gtfs.Route, routeToLine map[string]string, routesDir, nowStr string) error {
	lineShapes := make(map[string][][2]float64)
	lineColors := make(map[string]string)
	lineNames := make(map[string]string)

	for _, route := range routes {
		lineCode := routeToLine[route.RouteID]
		if route.RouteColor != "" {
			lineColors[lineCode] = "#" + route.RouteColor
		}
		if route.RouteLongName != "" {
			lineNames[lineCode] = route.RouteLongName
		}
	}

	for _, trip := range data.Trips {
		lineCode, ok := routeToLine[trip.RouteID]
		if !ok || trip.ShapeID == "" {
			continue
		}

		shapePoints, ok := data.Shapes[trip.ShapeID]
		if !ok {
			continue
		}

		coords := make([][2]float64, len(shapePoints))
		for i, sp := range shapePoints {
			coords[i] = [2]float64{sp.ShapePtLon, sp.ShapePtLat}
		}

		if existing, ok := lineShapes[lineCode]; !ok || len(coords) > len(existing) {
			lineShapes[lineCode] = coords
		}
	}

	for lineCode, coords := range lineShapes {
		if len(coords) < 2 {
			continue
		}

		color := lineColors[lineCode]
		if color == "" {
			color = "#DC143C" // Default bus color
		}

		feature := map[string]interface{}{
			"type": "FeatureCollection",
			"features": []map[string]interface{}{
				{
					"type": "Feature",
					"geometry": map[string]interface{}{
						"type":        "LineString",
						"coordinates": coords,
					},
					"properties": map[string]interface{}{
						"route_code":       lineCode,
						"route_name":       lineNames[lineCode],
						"color":            color,
						"last_verified_at": nowStr,
					},
				},
			},
		}

		data, err := json.MarshalIndent(feature, "", "  ")
		if err != nil {
			continue
		}

		// Sanitize filename
		fileName := strings.ReplaceAll(lineCode, "/", "_") + ".geojson"
		if err := os.WriteFile(filepath.Join(routesDir, fileName), data, 0644); err != nil {
			continue
		}
	}

	return nil
}

func generateBusStops(stops []gtfs.Stop, stopToLines map[string]map[string]bool, busDir string) error {
	type StopFeature struct {
		Type       string                 `json:"type"`
		Geometry   map[string]interface{} `json:"geometry"`
		Properties map[string]interface{} `json:"properties"`
	}

	var features []StopFeature

	for _, stop := range stops {
		if stop.LocationType != 0 && stop.LocationType != 1 {
			continue
		}

		linesMap, ok := stopToLines[stop.StopID]
		if !ok || len(linesMap) == 0 {
			continue
		}

		var lines []string
		for line := range linesMap {
			lines = append(lines, line)
		}
		sort.Strings(lines)

		features = append(features, StopFeature{
			Type: "Feature",
			Geometry: map[string]interface{}{
				"type":        "Point",
				"coordinates": [2]float64{stop.StopLon, stop.StopLat},
			},
			Properties: map[string]interface{}{
				"id":        stop.StopID,
				"name":      stop.StopName,
				"stop_code": stop.StopCode,
				"lines":     lines,
			},
		})
	}

	fc := map[string]interface{}{
		"type":     "FeatureCollection",
		"features": features,
	}

	data, err := json.MarshalIndent(fc, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(busDir, "stops.geojson"), data, 0644)
}

// manifestFileEntry matches the frontend's TmbManifestFile interface
type manifestFileEntry struct {
	Type      string `json:"type"`
	Path      string `json:"path"`
	LineCode  string `json:"line_code,omitempty"`
	RouteCode string `json:"route_code,omitempty"`
}

func generateTMBManifest(outputDir, nowStr string) error {
	var files []manifestFileEntry

	// Metro stations
	if _, err := os.Stat(filepath.Join(outputDir, "metro", "stations.geojson")); err == nil {
		files = append(files, manifestFileEntry{Type: "metro_stations", Path: "metro/stations.geojson"})
	}

	// Metro lines - scan directory for generated .geojson files
	metroLinesDir := filepath.Join(outputDir, "metro", "lines")
	if entries, err := os.ReadDir(metroLinesDir); err == nil {
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".geojson") {
				continue
			}
			lineCode := strings.TrimSuffix(entry.Name(), ".geojson")
			files = append(files, manifestFileEntry{
				Type:     "metro_line",
				LineCode: lineCode,
				Path:     "metro/lines/" + entry.Name(),
			})
		}
	}

	// Bus stops
	if _, err := os.Stat(filepath.Join(outputDir, "bus", "stops.geojson")); err == nil {
		files = append(files, manifestFileEntry{Type: "bus_stops", Path: "bus/stops.geojson"})
	}

	// Bus routes - scan directory for generated .geojson files
	busRoutesDir := filepath.Join(outputDir, "bus", "routes")
	if entries, err := os.ReadDir(busRoutesDir); err == nil {
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".geojson") {
				continue
			}
			routeCode := strings.TrimSuffix(entry.Name(), ".geojson")
			files = append(files, manifestFileEntry{
				Type:      "bus_route",
				RouteCode: routeCode,
				Path:      "bus/routes/" + entry.Name(),
			})
		}
	}

	manifest := map[string]interface{}{
		"version":      "1.0",
		"generated_at": nowStr,
		"files":        files,
	}

	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(outputDir, "manifest.json"), data, 0644)
}

func sha256Sum(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}
