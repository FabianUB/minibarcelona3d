/**
 * Unit tests for predictiveCalculator
 *
 * Phase 4, Task T026
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseTimeToSeconds,
  getCurrentTimeSeconds,
  calculateProgress,
  blendPositions,
  calculateGpsWeight,
  interpolateBearing,
  calculatePredictivePosition,
  DEFAULT_PREDICTIVE_CONFIG,
} from './predictiveCalculator';
import type { TrainPosition, TripDetails, StopTime } from '../../types/trains';
import type { Station } from '../../types/rodalies';
import type { PreprocessedRailwayLine } from './geometry';

// Mock the pathFinder module
vi.mock('./pathFinder', () => ({
  getPathBetweenStations: vi.fn(() => null),
}));

// Mock geometry functions
vi.mock('./geometry', () => ({
  sampleRailwayPosition: vi.fn(() => ({
    position: [2.17, 41.39],
    bearing: 45,
  })),
  snapTrainToRailway: vi.fn(() => ({
    position: [2.17, 41.39],
    bearing: 45,
    distance: 1000,
  })),
}));

// Helper to create mock stop times
const createStopTime = (
  stopId: string,
  sequence: number,
  scheduledArrival: string,
  scheduledDeparture: string,
  options: Partial<StopTime> = {}
): StopTime => ({
  stopId,
  stopSequence: sequence,
  stopName: `Station ${stopId}`,
  scheduledArrival,
  scheduledDeparture,
  predictedArrivalUtc: null,
  predictedDepartureUtc: null,
  arrivalDelaySeconds: null,
  departureDelaySeconds: null,
  scheduleRelationship: 'SCHEDULED',
  ...options,
});

// Helper to create mock trip details
const createTripDetails = (stopTimes: StopTime[]): TripDetails => ({
  tripId: 'trip_1',
  routeId: 'R1_TEST',
  stopTimes,
  updatedAt: '2024-01-01T08:00:00Z',
});

// Helper to create mock train position
const createTrainPosition = (
  options: Partial<TrainPosition> = {}
): TrainPosition => ({
  vehicleKey: 'train_1',
  latitude: 41.39,
  longitude: 2.17,
  nextStopId: 'STOP_2',
  routeId: 'R1_TEST',
  status: 'IN_TRANSIT_TO',
  polledAtUtc: new Date().toISOString(),
  ...options,
});

describe('parseTimeToSeconds', () => {
  it('should parse valid time strings', () => {
    expect(parseTimeToSeconds('08:30:00')).toBe(8 * 3600 + 30 * 60);
    expect(parseTimeToSeconds('00:00:00')).toBe(0);
    expect(parseTimeToSeconds('23:59:59')).toBe(23 * 3600 + 59 * 60 + 59);
  });

  it('should handle times past midnight', () => {
    // Some GTFS feeds use times like 25:30:00 for 1:30 AM next day
    expect(parseTimeToSeconds('25:30:00')).toBe(25 * 3600 + 30 * 60);
  });

  it('should return null for invalid inputs', () => {
    expect(parseTimeToSeconds(null)).toBeNull();
    expect(parseTimeToSeconds('')).toBeNull();
    expect(parseTimeToSeconds('invalid')).toBeNull();
    expect(parseTimeToSeconds('08:30')).toBeNull();
  });
});

describe('getCurrentTimeSeconds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return seconds since midnight', () => {
    vi.setSystemTime(new Date('2024-01-01T08:30:15'));
    expect(getCurrentTimeSeconds()).toBe(8 * 3600 + 30 * 60 + 15);
  });

  it('should handle midnight', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:00'));
    expect(getCurrentTimeSeconds()).toBe(0);
  });
});

describe('calculateProgress', () => {
  it('should calculate progress between stops', () => {
    const train = createTrainPosition({ nextStopId: 'STOP_2' });
    const tripDetails = createTripDetails([
      createStopTime('STOP_1', 1, '08:00:00', '08:01:00'),
      createStopTime('STOP_2', 2, '08:10:00', '08:11:00'),
    ]);

    // At 08:05:30, we should be about halfway
    const currentTime = 8 * 3600 + 5 * 60 + 30; // 08:05:30
    const result = calculateProgress(train, tripDetails, currentTime);

    expect(result).not.toBeNull();
    expect(result!.progress).toBeCloseTo(0.5, 1);
    expect(result!.previousStop.stopId).toBe('STOP_1');
    expect(result!.nextStop.stopId).toBe('STOP_2');
  });

  it('should return 0 progress at departure time', () => {
    const train = createTrainPosition({ nextStopId: 'STOP_2' });
    const tripDetails = createTripDetails([
      createStopTime('STOP_1', 1, '08:00:00', '08:01:00'),
      createStopTime('STOP_2', 2, '08:10:00', '08:11:00'),
    ]);

    const currentTime = 8 * 3600 + 1 * 60; // 08:01:00 (departure time)
    const result = calculateProgress(train, tripDetails, currentTime);

    expect(result).not.toBeNull();
    expect(result!.progress).toBe(0);
  });

  it('should return 1 progress at arrival time', () => {
    const train = createTrainPosition({ nextStopId: 'STOP_2' });
    const tripDetails = createTripDetails([
      createStopTime('STOP_1', 1, '08:00:00', '08:01:00'),
      createStopTime('STOP_2', 2, '08:10:00', '08:11:00'),
    ]);

    const currentTime = 8 * 3600 + 10 * 60; // 08:10:00 (arrival time)
    const result = calculateProgress(train, tripDetails, currentTime);

    expect(result).not.toBeNull();
    expect(result!.progress).toBe(1);
  });

  it('should clamp progress to 0-1 range', () => {
    const train = createTrainPosition({ nextStopId: 'STOP_2' });
    const tripDetails = createTripDetails([
      createStopTime('STOP_1', 1, '08:00:00', '08:01:00'),
      createStopTime('STOP_2', 2, '08:10:00', '08:11:00'),
    ]);

    // Before departure
    const beforeResult = calculateProgress(train, tripDetails, 7 * 3600);
    expect(beforeResult!.progress).toBe(0);

    // After arrival
    const afterResult = calculateProgress(train, tripDetails, 9 * 3600);
    expect(afterResult!.progress).toBe(1);
  });

  it('should return null if next stop not in schedule', () => {
    const train = createTrainPosition({ nextStopId: 'UNKNOWN_STOP' });
    const tripDetails = createTripDetails([
      createStopTime('STOP_1', 1, '08:00:00', '08:01:00'),
      createStopTime('STOP_2', 2, '08:10:00', '08:11:00'),
    ]);

    const result = calculateProgress(train, tripDetails, 8 * 3600 + 5 * 60);
    expect(result).toBeNull();
  });

  it('should return null if next stop is first stop', () => {
    const train = createTrainPosition({ nextStopId: 'STOP_1' });
    const tripDetails = createTripDetails([
      createStopTime('STOP_1', 1, '08:00:00', '08:01:00'),
      createStopTime('STOP_2', 2, '08:10:00', '08:11:00'),
    ]);

    const result = calculateProgress(train, tripDetails, 8 * 3600);
    expect(result).toBeNull();
  });

  it('should use predicted times when available', () => {
    const train = createTrainPosition({ nextStopId: 'STOP_2' });

    // Create predicted times using local time to match how calculateProgress extracts time
    // Predicted departure: 08:05:00 local, predicted arrival: 08:15:00 local
    const predictedDeparture = new Date();
    predictedDeparture.setHours(8, 5, 0, 0);
    const predictedArrival = new Date();
    predictedArrival.setHours(8, 15, 0, 0);

    const tripDetails = createTripDetails([
      createStopTime('STOP_1', 1, '08:00:00', '08:01:00', {
        predictedDepartureUtc: predictedDeparture.toISOString(), // 5 min late
      }),
      createStopTime('STOP_2', 2, '08:10:00', '08:11:00', {
        predictedArrivalUtc: predictedArrival.toISOString(), // 5 min late
      }),
    ]);

    // At 08:10:00, using predicted times (08:05-08:15), we should be at 50%
    const currentTime = 8 * 3600 + 10 * 60;
    const result = calculateProgress(train, tripDetails, currentTime);

    expect(result).not.toBeNull();
    expect(result!.usingPredictedTimes).toBe(true);
    expect(result!.progress).toBeCloseTo(0.5, 1);
  });
});

describe('blendPositions', () => {
  it('should blend two positions with equal weights', () => {
    const predicted: [number, number] = [2.0, 41.0];
    const gps: [number, number] = [2.2, 41.2];

    const result = blendPositions(predicted, gps, 0.5);

    expect(result[0]).toBeCloseTo(2.1);
    expect(result[1]).toBeCloseTo(41.1);
  });

  it('should return GPS position when weight is 1', () => {
    const predicted: [number, number] = [2.0, 41.0];
    const gps: [number, number] = [2.2, 41.2];

    const result = blendPositions(predicted, gps, 1);

    expect(result[0]).toBeCloseTo(2.2);
    expect(result[1]).toBeCloseTo(41.2);
  });

  it('should return predicted position when weight is 0', () => {
    const predicted: [number, number] = [2.0, 41.0];
    const gps: [number, number] = [2.2, 41.2];

    const result = blendPositions(predicted, gps, 0);

    expect(result[0]).toBeCloseTo(2.0);
    expect(result[1]).toBeCloseTo(41.0);
  });

  it('should clamp weight to 0-1 range', () => {
    const predicted: [number, number] = [2.0, 41.0];
    const gps: [number, number] = [2.2, 41.2];

    const over = blendPositions(predicted, gps, 1.5);
    expect(over[0]).toBeCloseTo(2.2);

    const under = blendPositions(predicted, gps, -0.5);
    expect(under[0]).toBeCloseTo(2.0);
  });
});

describe('calculateGpsWeight', () => {
  it('should return fresh weight when age is 0', () => {
    const weight = calculateGpsWeight(0, 60000, 0.8);
    expect(weight).toBe(0.8);
  });

  it('should return 0 when age exceeds max', () => {
    const weight = calculateGpsWeight(70000, 60000, 0.8);
    expect(weight).toBe(0);
  });

  it('should decay exponentially', () => {
    const weight1 = calculateGpsWeight(10000, 60000, 0.8);
    const weight2 = calculateGpsWeight(30000, 60000, 0.8);
    const weight3 = calculateGpsWeight(50000, 60000, 0.8);

    expect(weight1).toBeGreaterThan(weight2);
    expect(weight2).toBeGreaterThan(weight3);
    expect(weight3).toBeGreaterThan(0);
  });
});

describe('interpolateBearing', () => {
  it('should interpolate between bearings', () => {
    expect(interpolateBearing(0, 90, 0.5)).toBeCloseTo(45);
    expect(interpolateBearing(0, 90, 0)).toBe(0);
    expect(interpolateBearing(0, 90, 1)).toBe(90);
  });

  it('should handle wraparound (shortest path)', () => {
    // From 350 to 10 should go through 0, not 180
    expect(interpolateBearing(350, 10, 0.5)).toBeCloseTo(0);

    // From 10 to 350 should go backward through 0
    expect(interpolateBearing(10, 350, 0.5)).toBeCloseTo(0);
  });

  it('should normalize results to 0-360', () => {
    const result = interpolateBearing(350, 10, 1);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(360);
  });
});

describe('calculatePredictivePosition', () => {
  const mockStations = new Map<string, Station>();
  const mockRailways = new Map<string, PreprocessedRailwayLine>();

  beforeEach(() => {
    // Set up mock stations
    mockStations.set('STOP_1', {
      id: 'STOP_1',
      name: 'Station 1',
      code: null,
      lines: ['R1'],
      geometry: { type: 'Point', coordinates: [2.15, 41.38] },
    });
    mockStations.set('STOP_2', {
      id: 'STOP_2',
      name: 'Station 2',
      code: null,
      lines: ['R1'],
      geometry: { type: 'Point', coordinates: [2.19, 41.40] },
    });

    // Set up mock railway
    mockRailways.set('R1', {
      segments: [],
      lineId: 'R1',
      coordinates: [
        [2.15, 41.38],
        [2.17, 41.39],
        [2.19, 41.40],
      ],
      cumulativeDistances: [0, 1000, 2000],
      segmentBearings: [45, 45],
      totalLength: 2000,
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T08:05:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
    mockStations.clear();
    mockRailways.clear();
  });

  it('should calculate predictive position', () => {
    const train = createTrainPosition({
      nextStopId: 'STOP_2',
      routeId: 'R1_TEST',
    });

    const tripDetails = createTripDetails([
      createStopTime('STOP_1', 1, '08:00:00', '08:01:00'),
      createStopTime('STOP_2', 2, '08:10:00', '08:11:00'),
    ]);

    const result = calculatePredictivePosition(
      train,
      tripDetails,
      Date.now(),
      mockRailways,
      mockStations,
      DEFAULT_PREDICTIVE_CONFIG
    );

    expect(result).not.toBeNull();
    expect(result!.position).toBeDefined();
    expect(result!.bearing).toBeDefined();
    expect(result!.source).toBeDefined();
    expect(result!.confidence).toBeGreaterThan(0);
  });

  it('should return GPS position when no schedule available', () => {
    const train = createTrainPosition({
      nextStopId: null, // No next stop
      latitude: 41.39,
      longitude: 2.17,
    });

    const tripDetails = createTripDetails([]);

    const result = calculatePredictivePosition(
      train,
      tripDetails,
      Date.now(),
      mockRailways,
      mockStations,
      DEFAULT_PREDICTIVE_CONFIG
    );

    expect(result).not.toBeNull();
    expect(result!.source).toBe('gps');
    expect(result!.position[0]).toBe(2.17);
    expect(result!.position[1]).toBe(41.39);
  });

  it('should return null when no GPS and no schedule', () => {
    const train = createTrainPosition({
      nextStopId: null,
      latitude: null,
      longitude: null,
    });

    const tripDetails = createTripDetails([]);

    const result = calculatePredictivePosition(
      train,
      tripDetails,
      Date.now(),
      mockRailways,
      mockStations,
      DEFAULT_PREDICTIVE_CONFIG
    );

    expect(result).toBeNull();
  });
});
