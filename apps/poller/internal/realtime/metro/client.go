package metro

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/mini-rodalies-3d/poller/internal/config"
	"github.com/mini-rodalies-3d/poller/internal/db"
)

const (
	iMetroAPIURL           = "https://api.tmb.cat/v1/imetro/estacions"
	defaultSegmentTimeSecs = 120 // assumed travel time between adjacent stops
	averageSpeedMPS        = 8.33 // ~30 km/h
	// maxArrivalSeconds filters out trains that are too far away.
	// Only trains arriving within this time are considered "active" on the network.
	// 300 seconds (5 minutes) is roughly the time for a train to traverse 2-3 stations.
	maxArrivalSeconds = 300
)

// Poller handles real-time polling of Metro iMetro API
type Poller struct {
	db        *db.DB
	cfg       *config.Config
	client    *http.Client
	mu        sync.RWMutex              // protects stations and lineGeoms
	stations  map[string]Station        // keyed by stop_code
	lineGeoms map[string]LineGeometry
}

// NewPoller creates a new Metro poller
func NewPoller(database *db.DB, cfg *config.Config) *Poller {
	return &Poller{
		db:  database,
		cfg: cfg,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
		stations:  make(map[string]Station),
		lineGeoms: make(map[string]LineGeometry),
	}
}

// LoadStaticData loads stations and line geometries from GeoJSON files
func (p *Poller) LoadStaticData() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Load stations
	if err := p.loadStationsLocked(); err != nil {
		return fmt.Errorf("failed to load stations: %w", err)
	}

	// Load line geometries
	if err := p.loadLineGeometriesLocked(); err != nil {
		return fmt.Errorf("failed to load line geometries: %w", err)
	}

	log.Printf("Metro: loaded %d stations, %d line geometries", len(p.stations), len(p.lineGeoms))
	return nil
}

// loadStationsLocked loads stations - caller must hold p.mu lock
func (p *Poller) loadStationsLocked() error {
	data, err := os.ReadFile(p.cfg.StationsGeoJSON)
	if err != nil {
		return err
	}

	var geojson struct {
		Features []struct {
			Properties struct {
				ID       string   `json:"id"`
				StopCode string   `json:"stop_code"`
				Name     string   `json:"name"`
				Lines    []string `json:"lines"`
			} `json:"properties"`
			Geometry struct {
				Coordinates []float64 `json:"coordinates"`
			} `json:"geometry"`
		} `json:"features"`
	}

	if err := json.Unmarshal(data, &geojson); err != nil {
		return err
	}

	for _, f := range geojson.Features {
		if len(f.Geometry.Coordinates) >= 2 {
			p.stations[f.Properties.StopCode] = Station{
				StopID:    f.Properties.ID,
				StopCode:  f.Properties.StopCode,
				Name:      f.Properties.Name,
				Longitude: f.Geometry.Coordinates[0],
				Latitude:  f.Geometry.Coordinates[1],
				Lines:     f.Properties.Lines,
			}
		}
	}

	return nil
}

// loadLineGeometriesLocked loads line geometries - caller must hold p.mu lock
func (p *Poller) loadLineGeometriesLocked() error {
	files, err := filepath.Glob(filepath.Join(p.cfg.LinesDir, "*.geojson"))
	if err != nil {
		return err
	}

	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			log.Printf("Metro: failed to read %s: %v", file, err)
			continue
		}

		var geojson struct {
			Features []struct {
				Properties struct {
					LineCode string `json:"line_code"`
				} `json:"properties"`
				Geometry struct {
					Type        string      `json:"type"`
					Coordinates interface{} `json:"coordinates"`
				} `json:"geometry"`
			} `json:"features"`
		}

		if err := json.Unmarshal(data, &geojson); err != nil {
			log.Printf("Metro: failed to parse %s: %v", file, err)
			continue
		}

		for _, f := range geojson.Features {
			lineCode := f.Properties.LineCode
			if lineCode == "" {
				continue
			}

			var coords [][2]float64
			if f.Geometry.Type == "LineString" {
				if rawCoords, ok := f.Geometry.Coordinates.([]interface{}); ok {
					for _, c := range rawCoords {
						if point, ok := c.([]interface{}); ok && len(point) >= 2 {
							lng, _ := point[0].(float64)
							lat, _ := point[1].(float64)
							coords = append(coords, [2]float64{lng, lat})
						}
					}
				}
			}

			if len(coords) > 1 {
				p.lineGeoms[lineCode] = LineGeometry{
					LineCode:    lineCode,
					Coordinates: coords,
					TotalLength: CalculateLineLength(coords),
				}
			}
		}
	}

	return nil
}

// Poll fetches and processes iMetro arrivals
func (p *Poller) Poll(ctx context.Context) error {
	if p.cfg.TMBAppID == "" || p.cfg.TMBAppKey == "" {
		log.Println("Metro: TMB API credentials not configured, skipping")
		return nil
	}

	// Take a snapshot of static data to avoid holding lock during API calls
	p.mu.RLock()
	stations := p.stations
	lineGeoms := p.lineGeoms
	p.mu.RUnlock()

	polledAt := time.Now().UTC()

	// Fetch arrivals from iMetro API
	arrivals, err := p.fetchArrivals(ctx)
	if err != nil {
		return fmt.Errorf("failed to fetch arrivals: %w", err)
	}

	if len(arrivals) == 0 {
		log.Println("Metro: no arrivals found")
		return nil
	}

	// Filter arrivals to only include trains that are close (within maxArrivalSeconds).
	// This prevents counting trains that are far away but predicted to arrive eventually.
	// Without this filter, the API returns ~900+ arrivals for all future trains,
	// but we only want to show trains currently on the network (~138).
	filteredArrivals := make([]TrainArrival, 0, len(arrivals))
	for _, a := range arrivals {
		if a.SecondsToNext <= maxArrivalSeconds {
			filteredArrivals = append(filteredArrivals, a)
		}
	}

	log.Printf("Metro: filtered %d arrivals to %d (within %ds)", len(arrivals), len(filteredArrivals), maxArrivalSeconds)

	if len(filteredArrivals) == 0 {
		log.Println("Metro: no arrivals within threshold")
		return nil
	}

	// Group arrivals by train
	trainGroups := p.groupArrivalsByTrain(filteredArrivals)

	// Estimate positions
	var positions []EstimatedPosition
	for trainKey, trainArrivals := range trainGroups {
		pos := p.estimatePosition(trainKey, trainArrivals, stations, lineGeoms)
		if pos != nil {
			positions = append(positions, *pos)
		}
	}

	if len(positions) == 0 {
		log.Println("Metro: no positions estimated")
		return nil
	}

	// Create snapshot
	snapshotID, err := p.db.CreateSnapshot(ctx, polledAt)
	if err != nil {
		return fmt.Errorf("failed to create snapshot: %w", err)
	}

	// Convert to DB positions
	dbPositions := make([]db.MetroPosition, len(positions))
	for i, pos := range positions {
		dbPositions[i] = db.MetroPosition{
			VehicleKey:           pos.VehicleKey,
			LineCode:             pos.LineCode,
			RouteID:              pos.RouteID,
			DirectionID:          pos.DirectionID,
			Latitude:             pos.Latitude,
			Longitude:            pos.Longitude,
			Bearing:              pos.Bearing,
			PreviousStopID:       pos.PreviousStopID,
			NextStopID:           pos.NextStopID,
			PreviousStopName:     pos.PreviousStopName,
			NextStopName:         pos.NextStopName,
			Status:               pos.Status,
			ProgressFraction:     &pos.ProgressFraction,
			DistanceAlongLine:    &pos.DistanceAlongLine,
			EstimatedSpeedMPS:    &pos.EstimatedSpeedMPS,
			LineTotalLength:      &pos.LineTotalLength,
			Source:               pos.Source,
			Confidence:           pos.Confidence,
			ArrivalSecondsToNext: &pos.ArrivalSecondsToNext,
			EstimatedAt:          polledAt,
		}
	}

	// Write to database
	if err := p.db.UpsertMetroPositions(ctx, snapshotID, polledAt, dbPositions); err != nil {
		return fmt.Errorf("failed to write positions: %w", err)
	}

	log.Printf("Metro: polled %d trains", len(dbPositions))
	return nil
}

func (p *Poller) fetchArrivals(ctx context.Context) ([]TrainArrival, error) {
	url := fmt.Sprintf("%s?app_id=%s&app_key=%s", iMetroAPIURL, p.cfg.TMBAppID, p.cfg.TMBAppKey)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API returned %d: %s", resp.StatusCode, string(body))
	}

	// API returns an array directly, not {"features": [...]}
	var data []struct {
		CodiLinia    int `json:"codi_linia"`
		CodiVia      int `json:"codi_via"`
		CodiEstacio  int `json:"codi_estacio"`
		PropersTrens []struct {
			CodiServei    string `json:"codi_servei"`
			NomLinia      string `json:"nom_linia"`
			TempsRestant  int    `json:"temps_restant"`
			DestiTrajecte string `json:"desti_trajecte"`
			CodiTrajecte  string `json:"codi_trajecte"`
		} `json:"propers_trens"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	var arrivals []TrainArrival
	for _, entry := range data {
		lineCode := LineCodeMap[entry.CodiLinia]
		if lineCode == "" {
			lineCode = fmt.Sprintf("L%d", entry.CodiLinia)
		}

		for _, train := range entry.PropersTrens {
			if train.CodiServei == "" {
				continue
			}

			// Refine line code from train data
			nomLinia := train.NomLinia
			if nomLinia != "" {
				lineCode = nomLinia
			}

			arrivals = append(arrivals, TrainArrival{
				TrainID:       train.CodiServei,
				LineCode:      lineCode,
				Direction:     entry.CodiVia,
				StationCode:   fmt.Sprintf("%d", entry.CodiEstacio),
				SecondsToNext: train.TempsRestant,
				Destination:   train.DestiTrajecte,
				RouteCode:     train.CodiTrajecte,
			})
		}
	}

	return arrivals, nil
}

func (p *Poller) groupArrivalsByTrain(arrivals []TrainArrival) map[string][]TrainArrival {
	groups := make(map[string][]TrainArrival)

	for _, a := range arrivals {
		key := fmt.Sprintf("%s-%d-%s", a.LineCode, a.Direction, a.TrainID)
		groups[key] = append(groups[key], a)
	}

	// Sort each group by arrival time
	for key := range groups {
		sort.Slice(groups[key], func(i, j int) bool {
			return groups[key][i].SecondsToNext < groups[key][j].SecondsToNext
		})
	}

	return groups
}

func (p *Poller) estimatePosition(trainKey string, arrivals []TrainArrival, stations map[string]Station, lineGeoms map[string]LineGeometry) *EstimatedPosition {
	if len(arrivals) == 0 {
		return nil
	}

	// Use the closest arrival (smallest time)
	nextArrival := arrivals[0]
	lineCode := nextArrival.LineCode
	direction := nextArrival.Direction
	secondsToNext := nextArrival.SecondsToNext

	// Look up station
	station, ok := stations[nextArrival.StationCode]
	if !ok {
		return nil
	}

	var lat, lng float64
	var bearing *float64
	var status string
	var progress float64

	if secondsToNext <= 30 {
		// Train is arriving or at station
		if secondsToNext <= 0 {
			status = "STOPPED_AT"
		} else {
			status = "ARRIVING"
		}
		lat = station.Latitude
		lng = station.Longitude
		progress = 1.0
	} else {
		// Train is in transit
		status = "IN_TRANSIT_TO"
		progress = 1.0 - float64(secondsToNext)/float64(defaultSegmentTimeSecs)
		if progress < 0 {
			progress = 0
		}
		if progress > 1 {
			progress = 1
		}

		// Try to interpolate along line geometry
		lineGeom, hasGeom := lineGeoms[lineCode]
		if hasGeom && len(lineGeom.Coordinates) > 1 {
			// Find station position in line
			stationCoord := [2]float64{station.Longitude, station.Latitude}
			stationIdx := FindClosestPointIndex(lineGeom.Coordinates, stationCoord)

			if stationIdx > 0 {
				// Interpolate backwards from station
				pointsBack := int((1 - progress) * float64(min(stationIdx, 20)))
				if pointsBack > 0 {
					prevIdx := max(0, stationIdx-pointsBack)
					prevCoord := lineGeom.Coordinates[prevIdx]
					nextCoord := lineGeom.Coordinates[stationIdx]

					// Linear interpolation
					interProgress := progress * float64(pointsBack) / float64(max(1, pointsBack))
					interp := Interpolate(prevCoord, nextCoord, interProgress)
					lng = interp[0]
					lat = interp[1]

					// Calculate bearing
					b := Bearing(prevCoord[1], prevCoord[0], nextCoord[1], nextCoord[0])
					bearing = &b
				} else {
					lat = station.Latitude
					lng = station.Longitude
				}
			} else {
				lat = station.Latitude
				lng = station.Longitude
			}
		} else {
			lat = station.Latitude
			lng = station.Longitude
		}
	}

	// Determine confidence
	var confidence string
	if secondsToNext < 60 {
		confidence = "high"
	} else if secondsToNext < 300 {
		confidence = "medium"
	} else {
		confidence = "low"
	}

	// Build route ID
	lineNum := strings.TrimPrefix(lineCode, "L")
	lineNum = strings.TrimSuffix(lineNum, "N")
	lineNum = strings.TrimSuffix(lineNum, "S")
	routeID := fmt.Sprintf("1.%s.%d", lineNum, direction)

	// Direction ID (0 = outbound, 1 = inbound)
	directionID := 0
	if direction == 2 {
		directionID = 1
	}

	// Get line total length and calculate distance along line
	var lineTotalLength float64
	var distanceAlongLine float64
	if lineGeom, ok := lineGeoms[lineCode]; ok {
		lineTotalLength = lineGeom.TotalLength
		// Calculate distance from line start to current position
		distanceAlongLine = DistanceToPoint(lineGeom.Coordinates, [2]float64{lng, lat})
		// Clamp to valid range
		if distanceAlongLine < 0 {
			distanceAlongLine = 0
		}
		if distanceAlongLine > lineTotalLength {
			distanceAlongLine = lineTotalLength
		}
	}

	return &EstimatedPosition{
		VehicleKey:           fmt.Sprintf("metro-%s-%d-%s", lineCode, direction, nextArrival.TrainID),
		LineCode:             lineCode,
		RouteID:              &routeID,
		DirectionID:          directionID,
		Latitude:             lat,
		Longitude:            lng,
		Bearing:              bearing,
		NextStopID:           &station.StopID,
		NextStopName:         &station.Name,
		Status:               status,
		ProgressFraction:     progress,
		DistanceAlongLine:    distanceAlongLine,
		EstimatedSpeedMPS:    averageSpeedMPS,
		LineTotalLength:      lineTotalLength,
		Source:               "imetro",
		Confidence:           confidence,
		ArrivalSecondsToNext: secondsToNext,
	}
}
