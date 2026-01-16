package metrics

import "math"

// WelfordState holds running statistics using Welford's online algorithm.
// This allows computing mean and standard deviation incrementally in O(1) time
// and space, without storing all observations.
type WelfordState struct {
	Count int     // n - number of observations
	Mean  float64 // running mean
	M2    float64 // sum of squared differences from mean (for variance)
}

// NewWelfordState creates a new Welford state from existing baseline data.
// This allows resuming incremental updates from previously saved statistics.
func NewWelfordState(mean, stddev float64, count int) *WelfordState {
	if count == 0 {
		return &WelfordState{}
	}
	// Reconstruct M2 from stddev: stddev = sqrt(M2 / n), so M2 = stddev^2 * n
	variance := stddev * stddev
	m2 := variance * float64(count)
	return &WelfordState{
		Count: count,
		Mean:  mean,
		M2:    m2,
	}
}

// Update adds a new observation using Welford's online algorithm.
// This is numerically stable and computes running mean and variance.
// Reference: https://en.wikipedia.org/wiki/Algorithms_for_calculating_variance#Welford's_online_algorithm
func (w *WelfordState) Update(newValue float64) {
	w.Count++
	delta := newValue - w.Mean
	w.Mean += delta / float64(w.Count)
	delta2 := newValue - w.Mean
	w.M2 += delta * delta2
}

// GetMean returns the current mean.
func (w *WelfordState) GetMean() float64 {
	return w.Mean
}

// GetStdDev returns the population standard deviation.
// Returns 0 if fewer than 2 observations.
func (w *WelfordState) GetStdDev() float64 {
	if w.Count < 2 {
		return 0
	}
	variance := w.M2 / float64(w.Count)
	return math.Sqrt(variance)
}

// GetCount returns the number of observations.
func (w *WelfordState) GetCount() int {
	return w.Count
}
