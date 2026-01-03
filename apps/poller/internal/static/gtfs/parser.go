package gtfs

import (
	"archive/zip"
	"encoding/csv"
	"fmt"
	"io"
	"log"
	"sort"
	"strconv"
	"strings"
)

// Parse reads a GTFS zip file and returns parsed data
func Parse(zipPath string) (*Data, error) {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open zip: %w", err)
	}
	defer r.Close()

	data := &Data{
		Shapes: make(map[string][]ShapePoint),
	}

	// Build file map for easy lookup
	files := make(map[string]*zip.File)
	for _, f := range r.File {
		files[f.Name] = f
	}

	// Parse routes.txt
	if f, ok := files["routes.txt"]; ok {
		routes, err := parseRoutes(f)
		if err != nil {
			log.Printf("Warning: failed to parse routes.txt: %v", err)
		} else {
			data.Routes = routes
		}
	}

	// Parse stops.txt
	if f, ok := files["stops.txt"]; ok {
		stops, err := parseStops(f)
		if err != nil {
			log.Printf("Warning: failed to parse stops.txt: %v", err)
		} else {
			data.Stops = stops
		}
	}

	// Parse trips.txt
	if f, ok := files["trips.txt"]; ok {
		trips, err := parseTrips(f)
		if err != nil {
			log.Printf("Warning: failed to parse trips.txt: %v", err)
		} else {
			data.Trips = trips
		}
	}

	// Parse shapes.txt
	if f, ok := files["shapes.txt"]; ok {
		shapes, err := parseShapes(f)
		if err != nil {
			log.Printf("Warning: failed to parse shapes.txt: %v", err)
		} else {
			data.Shapes = shapes
		}
	}

	// Parse stop_times.txt
	if f, ok := files["stop_times.txt"]; ok {
		stopTimes, err := parseStopTimes(f)
		if err != nil {
			log.Printf("Warning: failed to parse stop_times.txt: %v", err)
		} else {
			data.StopTimes = stopTimes
		}
	}

	// Parse agency.txt
	if f, ok := files["agency.txt"]; ok {
		agencies, err := parseAgencies(f)
		if err != nil {
			log.Printf("Warning: failed to parse agency.txt: %v", err)
		} else {
			data.Agency = agencies
		}
	}

	log.Printf("GTFS parsed: %d routes, %d stops, %d trips, %d shapes",
		len(data.Routes), len(data.Stops), len(data.Trips), len(data.Shapes))

	return data, nil
}

func parseRoutes(f *zip.File) ([]Route, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()

	reader := csv.NewReader(rc)
	header, err := reader.Read()
	if err != nil {
		return nil, err
	}

	idx := makeIndex(header)
	var routes []Route

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		routeType, _ := strconv.Atoi(getField(record, idx, "route_type"))

		routes = append(routes, Route{
			RouteID:        getField(record, idx, "route_id"),
			AgencyID:       getField(record, idx, "agency_id"),
			RouteShortName: getField(record, idx, "route_short_name"),
			RouteLongName:  getField(record, idx, "route_long_name"),
			RouteType:      routeType,
			RouteColor:     getField(record, idx, "route_color"),
			RouteTextColor: getField(record, idx, "route_text_color"),
		})
	}

	return routes, nil
}

func parseStops(f *zip.File) ([]Stop, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()

	reader := csv.NewReader(rc)
	header, err := reader.Read()
	if err != nil {
		return nil, err
	}

	idx := makeIndex(header)
	var stops []Stop

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		lat, _ := strconv.ParseFloat(getField(record, idx, "stop_lat"), 64)
		lon, _ := strconv.ParseFloat(getField(record, idx, "stop_lon"), 64)
		locType, _ := strconv.Atoi(getField(record, idx, "location_type"))

		stops = append(stops, Stop{
			StopID:        getField(record, idx, "stop_id"),
			StopCode:      getField(record, idx, "stop_code"),
			StopName:      getField(record, idx, "stop_name"),
			StopLat:       lat,
			StopLon:       lon,
			LocationType:  locType,
			ParentStation: getField(record, idx, "parent_station"),
		})
	}

	return stops, nil
}

func parseTrips(f *zip.File) ([]Trip, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()

	reader := csv.NewReader(rc)
	header, err := reader.Read()
	if err != nil {
		return nil, err
	}

	idx := makeIndex(header)
	var trips []Trip

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		directionID, _ := strconv.Atoi(getField(record, idx, "direction_id"))

		trips = append(trips, Trip{
			RouteID:      getField(record, idx, "route_id"),
			ServiceID:    getField(record, idx, "service_id"),
			TripID:       getField(record, idx, "trip_id"),
			TripHeadsign: getField(record, idx, "trip_headsign"),
			DirectionID:  directionID,
			ShapeID:      getField(record, idx, "shape_id"),
		})
	}

	return trips, nil
}

func parseShapes(f *zip.File) (map[string][]ShapePoint, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()

	reader := csv.NewReader(rc)
	header, err := reader.Read()
	if err != nil {
		return nil, err
	}

	idx := makeIndex(header)
	shapes := make(map[string][]ShapePoint)

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		shapeID := getField(record, idx, "shape_id")
		lat, _ := strconv.ParseFloat(getField(record, idx, "shape_pt_lat"), 64)
		lon, _ := strconv.ParseFloat(getField(record, idx, "shape_pt_lon"), 64)
		seq, _ := strconv.Atoi(getField(record, idx, "shape_pt_sequence"))
		dist, _ := strconv.ParseFloat(getField(record, idx, "shape_dist_traveled"), 64)

		shapes[shapeID] = append(shapes[shapeID], ShapePoint{
			ShapeID:           shapeID,
			ShapePtLat:        lat,
			ShapePtLon:        lon,
			ShapePtSequence:   seq,
			ShapeDistTraveled: dist,
		})
	}

	// Sort each shape by sequence
	for shapeID := range shapes {
		sort.Slice(shapes[shapeID], func(i, j int) bool {
			return shapes[shapeID][i].ShapePtSequence < shapes[shapeID][j].ShapePtSequence
		})
	}

	return shapes, nil
}

func parseStopTimes(f *zip.File) ([]StopTime, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()

	reader := csv.NewReader(rc)
	header, err := reader.Read()
	if err != nil {
		return nil, err
	}

	idx := makeIndex(header)
	var stopTimes []StopTime

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		seq, _ := strconv.Atoi(getField(record, idx, "stop_sequence"))

		stopTimes = append(stopTimes, StopTime{
			TripID:        getField(record, idx, "trip_id"),
			ArrivalTime:   getField(record, idx, "arrival_time"),
			DepartureTime: getField(record, idx, "departure_time"),
			StopID:        getField(record, idx, "stop_id"),
			StopSequence:  seq,
		})
	}

	return stopTimes, nil
}

func parseAgencies(f *zip.File) ([]Agency, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()

	reader := csv.NewReader(rc)
	header, err := reader.Read()
	if err != nil {
		return nil, err
	}

	idx := makeIndex(header)
	var agencies []Agency

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		agencies = append(agencies, Agency{
			AgencyID:   getField(record, idx, "agency_id"),
			AgencyName: getField(record, idx, "agency_name"),
			AgencyURL:  getField(record, idx, "agency_url"),
		})
	}

	return agencies, nil
}

func makeIndex(header []string) map[string]int {
	idx := make(map[string]int)
	for i, h := range header {
		idx[strings.TrimSpace(h)] = i
	}
	return idx
}

func getField(record []string, idx map[string]int, field string) string {
	if i, ok := idx[field]; ok && i < len(record) {
		return strings.TrimSpace(record[i])
	}
	return ""
}
