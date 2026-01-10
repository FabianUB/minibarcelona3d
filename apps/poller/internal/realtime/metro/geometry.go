package metro

import "math"

const earthRadiusMeters = 6371000

// Haversine calculates the distance between two points in meters
func Haversine(lat1, lon1, lat2, lon2 float64) float64 {
	phi1 := lat1 * math.Pi / 180
	phi2 := lat2 * math.Pi / 180
	deltaPhi := (lat2 - lat1) * math.Pi / 180
	deltaLambda := (lon2 - lon1) * math.Pi / 180

	a := math.Sin(deltaPhi/2)*math.Sin(deltaPhi/2) +
		math.Cos(phi1)*math.Cos(phi2)*math.Sin(deltaLambda/2)*math.Sin(deltaLambda/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return earthRadiusMeters * c
}

// Bearing calculates the bearing from point 1 to point 2 in degrees (0-360)
func Bearing(lat1, lon1, lat2, lon2 float64) float64 {
	phi1 := lat1 * math.Pi / 180
	phi2 := lat2 * math.Pi / 180
	deltaLambda := (lon2 - lon1) * math.Pi / 180

	x := math.Sin(deltaLambda) * math.Cos(phi2)
	y := math.Cos(phi1)*math.Sin(phi2) - math.Sin(phi1)*math.Cos(phi2)*math.Cos(deltaLambda)

	bearing := math.Atan2(x, y) * 180 / math.Pi
	return math.Mod(bearing+360, 360)
}

// Interpolate linearly interpolates between two points
func Interpolate(start, end [2]float64, fraction float64) [2]float64 {
	return [2]float64{
		start[0] + (end[0]-start[0])*fraction,
		start[1] + (end[1]-start[1])*fraction,
	}
}

// FindClosestPointIndex finds the index of the closest point in a coordinate list
func FindClosestPointIndex(coords [][2]float64, target [2]float64) int {
	minDist := math.MaxFloat64
	minIdx := 0

	for i, coord := range coords {
		// coord is [lng, lat], target is [lng, lat]
		dist := Haversine(coord[1], coord[0], target[1], target[0])
		if dist < minDist {
			minDist = dist
			minIdx = i
		}
	}

	return minIdx
}

// CalculateLineLength calculates the total length of a line in meters
func CalculateLineLength(coords [][2]float64) float64 {
	var total float64
	for i := 1; i < len(coords); i++ {
		total += Haversine(
			coords[i-1][1], coords[i-1][0],
			coords[i][1], coords[i][0],
		)
	}
	return total
}

// DistanceToPoint calculates the distance along a line from its start to a given point.
// It finds the closest segment on the line and returns the cumulative distance.
func DistanceToPoint(coords [][2]float64, target [2]float64) float64 {
	if len(coords) < 2 {
		return 0
	}

	// Find the closest point index
	closestIdx := FindClosestPointIndex(coords, target)

	// Calculate cumulative distance to the closest point
	var cumDistance float64
	for i := 1; i <= closestIdx; i++ {
		cumDistance += Haversine(
			coords[i-1][1], coords[i-1][0],
			coords[i][1], coords[i][0],
		)
	}

	// If we're between the closest point and the next/prev point,
	// add the fractional distance to the target
	closestCoord := coords[closestIdx]
	distToClosest := Haversine(closestCoord[1], closestCoord[0], target[1], target[0])

	// Check if we should look at the segment before or after
	if closestIdx > 0 && closestIdx < len(coords)-1 {
		// Check which adjacent point the target is closer to
		prevDist := Haversine(coords[closestIdx-1][1], coords[closestIdx-1][0], target[1], target[0])
		nextDist := Haversine(coords[closestIdx+1][1], coords[closestIdx+1][0], target[1], target[0])

		if prevDist < nextDist && prevDist < distToClosest {
			// Target is between prev and closest, subtract fractional distance
			cumDistance -= distToClosest
		} else if nextDist < distToClosest {
			// Target is between closest and next, add fractional distance
			cumDistance += distToClosest
		}
	} else if closestIdx == 0 {
		// At start, add distance from start to target
		cumDistance = distToClosest
	}

	return cumDistance
}
