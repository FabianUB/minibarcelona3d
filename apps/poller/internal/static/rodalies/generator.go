package rodalies

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

// RodaliesLine represents a Rodalies line for the frontend
type RodaliesLine struct {
	ID                  string `json:"id"`
	Name                string `json:"name"`
	ShortCode           string `json:"short_code"`
	BrandColor          string `json:"brand_color"`
	DefaultPattern      string `json:"default_pattern"`
	HighContrastPattern string `json:"high_contrast_pattern"`
	Order               int    `json:"order"`
}

// LegendEntry represents a legend entry for the frontend
type LegendEntry struct {
	LineID        string            `json:"line_id"`
	Label         string            `json:"label"`
	ThemeTokens   LegendThemeTokens `json:"theme_tokens"`
	IsHighlighted bool              `json:"is_highlighted"`
}

// LegendThemeTokens contains theme-specific patterns
type LegendThemeTokens struct {
	Standard     string `json:"standard"`
	HighContrast string `json:"high_contrast"`
}

// LineFeature represents a GeoJSON Feature for a line
type LineFeature struct {
	Type       string              `json:"type"`
	ID         string              `json:"id"`
	Properties LineFeatureProps    `json:"properties"`
	Geometry   LineStringGeometry  `json:"geometry"`
}

// LineFeatureProps contains line properties
type LineFeatureProps struct {
	ID                  string `json:"id"`
	Name                string `json:"name"`
	ShortCode           string `json:"short_code"`
	BrandColor          string `json:"brand_color"`
	DefaultPattern      string `json:"default_pattern"`
	HighContrastPattern string `json:"high_contrast_pattern"`
	Order               int    `json:"order"`
	LastVerifiedAt      string `json:"last_verified_at"`
}

// LineStringGeometry represents LineString geometry
type LineStringGeometry struct {
	Type        string       `json:"type"`
	Coordinates [][2]float64 `json:"coordinates"`
}

// StationFeatureCollection is a GeoJSON FeatureCollection for stations
type StationFeatureCollection struct {
	Type     string           `json:"type"`
	Features []StationFeature `json:"features"`
}

// StationFeature represents a station GeoJSON feature
type StationFeature struct {
	Type       string        `json:"type"`
	ID         string        `json:"id"`
	Properties StationProps  `json:"properties"`
	Geometry   PointGeometry `json:"geometry"`
}

// StationProps contains station properties
type StationProps struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Code  *string  `json:"code"`
	Lines []string `json:"lines"`
}

// PointGeometry represents Point geometry
type PointGeometry struct {
	Type        string     `json:"type"`
	Coordinates [2]float64 `json:"coordinates"`
}

// Manifest represents the manifest.json structure
type Manifest struct {
	Lines              []ManifestLine `json:"lines"`
	Stations           ManifestFile   `json:"stations"`
	Viewport           ManifestViewport `json:"viewport"`
	UpdatedAt          string         `json:"updated_at"`
	RodaliesLinesPath  string         `json:"rodalies_lines_path"`
	LegendEntriesPath  string         `json:"legend_entries_path"`
	LineGeometriesPath string         `json:"line_geometries_path"`
	MapViewportPath    string         `json:"map_viewport_path"`
	MapUIStatePath     string         `json:"map_ui_state_path"`
}

// ManifestLine represents a line entry in the manifest
type ManifestLine struct {
	ID       string `json:"id"`
	Checksum string `json:"checksum"`
	Path     string `json:"path"`
}

// ManifestFile represents a file entry
type ManifestFile struct {
	Path     string `json:"path"`
	Checksum string `json:"checksum"`
}

// ManifestViewport contains viewport settings
type ManifestViewport struct {
	Center    ManifestCenter  `json:"center"`
	Zoom      float64         `json:"zoom"`
	MaxBounds [][2]float64    `json:"max_bounds"`
	Padding   ManifestPadding `json:"padding"`
}

// ManifestCenter contains center coordinates
type ManifestCenter struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// ManifestPadding contains padding values
type ManifestPadding struct {
	Top    int `json:"top"`
	Right  int `json:"right"`
	Bottom int `json:"bottom"`
	Left   int `json:"left"`
}

// MapViewport contains the viewport JSON structure
type MapViewport struct {
	Center    ManifestCenter  `json:"center"`
	Zoom      float64         `json:"zoom"`
	MaxBounds [][2]float64    `json:"max_bounds"`
	Padding   ManifestPadding `json:"padding"`
}

// LineColorMap contains brand colors for Rodalies lines
var LineColorMap = map[string]string{
	"R1":  "7DBCEC",
	"R2":  "26A741",
	"R2N": "D0DF00",
	"R2S": "146520",
	"R3":  "EB4128",
	"R4":  "F7A30D",
	"R7":  "B57CBB",
	"R8":  "88016A",
	"RG1": "409EF5",
	"RL3": "B6AE33",
	"RL4": "F7A30D",
	"RT2": "F965DE",
	"R11": "0069AA",
	"R14": "6C60A8",
	"R15": "978571",
	"R16": "B52B46",
	"R17": "F3B12E",
}

// LineOrderMap contains display order for Rodalies lines
var LineOrderMap = map[string]int{
	"R1":  0,
	"R2":  1,
	"R2N": 2,
	"R2S": 3,
	"R3":  4,
	"R4":  6,
	"R7":  7,
	"R8":  8,
	"RG1": 9,
	"RL3": 10,
	"RL4": 11,
	"RT2": 12,
	"R11": 13,
	"R14": 14,
	"R15": 15,
	"R16": 16,
	"R17": 17,
}

// Generate creates GeoJSON files from GTFS data
func Generate(data *gtfs.Data, outputDir string) error {
	// Create output directories
	linesDir := filepath.Join(outputDir, "lines")
	if err := os.MkdirAll(linesDir, 0755); err != nil {
		return fmt.Errorf("failed to create lines directory: %w", err)
	}

	now := time.Now().UTC()
	nowStr := now.Format(time.RFC3339)

	// Build route to line mapping
	routeToLine := buildRouteToLineMapping(data.Routes)

	// Build stop to lines mapping (which lines serve each stop)
	stopToLines := buildStopToLinesMapping(data.Trips, data.StopTimes, routeToLine)

	// Generate line GeoJSON files
	lineManifests, rodaliesLines, err := generateLineFiles(data, routeToLine, linesDir, nowStr)
	if err != nil {
		return fmt.Errorf("failed to generate line files: %w", err)
	}

	// Generate Station.geojson
	stationsChecksum, err := generateStations(data.Stops, stopToLines, outputDir)
	if err != nil {
		return fmt.Errorf("failed to generate stations: %w", err)
	}

	// Generate RodaliesLine.json
	if err := writeJSON(filepath.Join(outputDir, "RodaliesLine.json"), rodaliesLines); err != nil {
		return fmt.Errorf("failed to write RodaliesLine.json: %w", err)
	}

	// Generate MapViewport.json
	viewport := computeViewport(data.Stops)
	if err := writeJSON(filepath.Join(outputDir, "MapViewport.json"), viewport); err != nil {
		return fmt.Errorf("failed to write MapViewport.json: %w", err)
	}

	// Generate LegendEntry.json with correct format
	legendEntries := make([]LegendEntry, len(rodaliesLines))
	for i, line := range rodaliesLines {
		legendEntries[i] = LegendEntry{
			LineID: line.ID,
			Label:  fmt.Sprintf("%s - %s", line.ShortCode, line.Name),
			ThemeTokens: LegendThemeTokens{
				Standard:     line.DefaultPattern,
				HighContrast: line.HighContrastPattern,
			},
			IsHighlighted: false,
		}
	}
	if err := writeJSON(filepath.Join(outputDir, "LegendEntry.json"), legendEntries); err != nil {
		return fmt.Errorf("failed to write LegendEntry.json: %w", err)
	}

	// Generate MapUIState.json
	uiState := map[string]interface{}{
		"selectedLine":    nil,
		"highlightMode":   "none",
		"highContrastMode": false,
		"showLegend":      true,
	}
	if err := writeJSON(filepath.Join(outputDir, "MapUIState.json"), uiState); err != nil {
		return fmt.Errorf("failed to write MapUIState.json: %w", err)
	}

	// Generate combined LineGeometry.geojson
	if err := generateCombinedLineGeometry(data, routeToLine, rodaliesLines, outputDir, nowStr); err != nil {
		log.Printf("Warning: failed to generate combined LineGeometry.geojson: %v", err)
	}

	// Generate manifest.json
	manifest := Manifest{
		Lines: lineManifests,
		Stations: ManifestFile{
			Path:     "Station.geojson",
			Checksum: stationsChecksum,
		},
		Viewport: ManifestViewport{
			Center:    viewport.Center,
			Zoom:      viewport.Zoom,
			MaxBounds: viewport.MaxBounds,
			Padding:   viewport.Padding,
		},
		UpdatedAt:          nowStr,
		RodaliesLinesPath:  "RodaliesLine.json",
		LegendEntriesPath:  "LegendEntry.json",
		LineGeometriesPath: "LineGeometry.geojson",
		MapViewportPath:    "MapViewport.json",
		MapUIStatePath:     "MapUIState.json",
	}

	if err := writeJSON(filepath.Join(outputDir, "manifest.json"), manifest); err != nil {
		return fmt.Errorf("failed to write manifest.json: %w", err)
	}

	log.Printf("Rodalies: generated %d lines, %d stations", len(lineManifests), len(data.Stops))
	return nil
}

func buildRouteToLineMapping(routes []gtfs.Route) map[string]string {
	mapping := make(map[string]string)
	for _, route := range routes {
		// Extract line code from route_short_name (e.g., "R1", "R2N")
		lineCode := route.RouteShortName
		if lineCode == "" {
			continue
		}
		// Normalize line codes
		lineCode = strings.ToUpper(lineCode)
		mapping[route.RouteID] = lineCode
	}
	return mapping
}

func buildStopToLinesMapping(trips []gtfs.Trip, stopTimes []gtfs.StopTime, routeToLine map[string]string) map[string]map[string]bool {
	// First, build trip to line mapping
	tripToLine := make(map[string]string)
	for _, trip := range trips {
		if line, ok := routeToLine[trip.RouteID]; ok {
			tripToLine[trip.TripID] = line
		}
	}

	// Then, build stop to lines mapping
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

func generateLineFiles(data *gtfs.Data, routeToLine map[string]string, linesDir, nowStr string) ([]ManifestLine, []RodaliesLine, error) {
	// Group shapes by line
	lineShapes := make(map[string][][2]float64)

	for _, trip := range data.Trips {
		lineCode, ok := routeToLine[trip.RouteID]
		if !ok || trip.ShapeID == "" {
			continue
		}

		shapePoints, ok := data.Shapes[trip.ShapeID]
		if !ok {
			continue
		}

		// Use the longest shape for each line
		coords := make([][2]float64, len(shapePoints))
		for i, sp := range shapePoints {
			coords[i] = [2]float64{sp.ShapePtLon, sp.ShapePtLat}
		}

		if existing, ok := lineShapes[lineCode]; !ok || len(coords) > len(existing) {
			lineShapes[lineCode] = coords
		}
	}

	// Also get line names from routes
	lineNames := make(map[string]string)
	for _, route := range data.Routes {
		if lineCode, ok := routeToLine[route.RouteID]; ok {
			if route.RouteLongName != "" {
				lineNames[lineCode] = route.RouteLongName
			} else {
				lineNames[lineCode] = route.RouteShortName
			}
		}
	}

	var manifests []ManifestLine
	var rodaliesLines []RodaliesLine

	// Sort lines for consistent output
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

		color := LineColorMap[lineCode]
		if color == "" {
			color = "888888" // Default gray
		}

		order := LineOrderMap[lineCode]
		name := lineNames[lineCode]
		if name == "" {
			name = lineCode
		}

		// Create line feature
		feature := LineFeature{
			Type: "Feature",
			ID:   lineCode,
			Properties: LineFeatureProps{
				ID:                  lineCode,
				Name:                name,
				ShortCode:           lineCode,
				BrandColor:          color,
				DefaultPattern:      fmt.Sprintf("solid-%s", strings.ToLower(lineCode)),
				HighContrastPattern: fmt.Sprintf("hatched-%s", strings.ToLower(lineCode)),
				Order:               order,
				LastVerifiedAt:      nowStr,
			},
			Geometry: LineStringGeometry{
				Type:        "LineString",
				Coordinates: coords,
			},
		}

		// Write file
		filePath := filepath.Join(linesDir, lineCode+".geojson")
		data, err := json.MarshalIndent(feature, "", "  ")
		if err != nil {
			return nil, nil, err
		}

		if err := os.WriteFile(filePath, data, 0644); err != nil {
			return nil, nil, err
		}

		checksum := sha256Sum(data)

		manifests = append(manifests, ManifestLine{
			ID:       lineCode,
			Checksum: checksum,
			Path:     fmt.Sprintf("lines/%s.geojson", lineCode),
		})

		rodaliesLines = append(rodaliesLines, RodaliesLine{
			ID:                  lineCode,
			Name:                name,
			ShortCode:           lineCode,
			BrandColor:          color,
			DefaultPattern:      fmt.Sprintf("solid-%s", strings.ToLower(lineCode)),
			HighContrastPattern: fmt.Sprintf("hatched-%s", strings.ToLower(lineCode)),
			Order:               order,
		})
	}

	// Sort by order
	sort.Slice(rodaliesLines, func(i, j int) bool {
		return rodaliesLines[i].Order < rodaliesLines[j].Order
	})

	return manifests, rodaliesLines, nil
}

func generateStations(stops []gtfs.Stop, stopToLines map[string]map[string]bool, outputDir string) (string, error) {
	var features []StationFeature

	for _, stop := range stops {
		// Skip non-stations (e.g., entrances)
		if stop.LocationType != 0 && stop.LocationType != 1 {
			continue
		}

		// Get lines serving this station
		var lines []string
		if linesMap, ok := stopToLines[stop.StopID]; ok {
			for line := range linesMap {
				lines = append(lines, line)
			}
			sort.Strings(lines)
		}

		// Skip stations not served by any Rodalies line
		if len(lines) == 0 {
			continue
		}

		var code *string
		if stop.StopCode != "" {
			code = &stop.StopCode
		}

		features = append(features, StationFeature{
			Type: "Feature",
			ID:   stop.StopID,
			Properties: StationProps{
				ID:    stop.StopID,
				Name:  stop.StopName,
				Code:  code,
				Lines: lines,
			},
			Geometry: PointGeometry{
				Type:        "Point",
				Coordinates: [2]float64{stop.StopLon, stop.StopLat},
			},
		})
	}

	// Sort by name for consistent output
	sort.Slice(features, func(i, j int) bool {
		return features[i].Properties.Name < features[j].Properties.Name
	})

	fc := StationFeatureCollection{
		Type:     "FeatureCollection",
		Features: features,
	}

	data, err := json.MarshalIndent(fc, "", "  ")
	if err != nil {
		return "", err
	}

	if err := os.WriteFile(filepath.Join(outputDir, "Station.geojson"), data, 0644); err != nil {
		return "", err
	}

	return sha256Sum(data), nil
}

func generateCombinedLineGeometry(data *gtfs.Data, routeToLine map[string]string, rodaliesLines []RodaliesLine, outputDir, nowStr string) error {
	type CombinedFeature struct {
		Type       string              `json:"type"`
		ID         string              `json:"id"`
		Properties LineFeatureProps    `json:"properties"`
		Geometry   LineStringGeometry  `json:"geometry"`
	}

	type CombinedFC struct {
		Type     string            `json:"type"`
		Features []CombinedFeature `json:"features"`
	}

	// Read individual line files and combine
	linesDir := filepath.Join(outputDir, "lines")
	var features []CombinedFeature

	for _, line := range rodaliesLines {
		filePath := filepath.Join(linesDir, line.ID+".geojson")
		fileData, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}

		var feature LineFeature
		if err := json.Unmarshal(fileData, &feature); err != nil {
			continue
		}

		features = append(features, CombinedFeature{
			Type:       feature.Type,
			ID:         feature.ID,
			Properties: feature.Properties,
			Geometry:   feature.Geometry,
		})
	}

	fc := CombinedFC{
		Type:     "FeatureCollection",
		Features: features,
	}

	return writeJSON(filepath.Join(outputDir, "LineGeometry.geojson"), fc)
}

func computeViewport(stops []gtfs.Stop) MapViewport {
	// Always use Barcelona viewport for this Barcelona-focused app.
	// The Renfe GTFS data covers all of Spain's Rodalies networks (Madrid, Valencia, etc.),
	// so computing the viewport from all stops would center the map on central Spain.
	// We hardcode Barcelona coordinates to ensure correct initial view.
	return MapViewport{
		Center: ManifestCenter{Lat: 41.3896, Lng: 2.170302},
		Zoom:   13.48,
		MaxBounds: [][2]float64{
			{0.249476, 40.395723},
			{3.363469, 42.65891},
		},
		Padding: ManifestPadding{Top: 48, Right: 24, Bottom: 48, Left: 24},
	}
}

func writeJSON(path string, v interface{}) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func sha256Sum(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}
