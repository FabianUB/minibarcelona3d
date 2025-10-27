/**
 * Unit tests for geometry utilities
 *
 * Tests bearing calculations and position interpolation
 * for train orientation and smooth movement.
 */

import { describe, expect, test } from 'vitest';
import {
  calculateBearing,
  interpolatePosition,
  easeInOutCubic,
  interpolatePositionSmooth,
  type Position,
} from '../geometry';

describe('calculateBearing', () => {
  test('calculates bearing from Barcelona to Madrid (west)', () => {
    // Barcelona: 41.3851°N, 2.1734°E
    // Madrid: 40.4168°N, -3.7038°W
    const bearing = calculateBearing(41.3851, 2.1734, 40.4168, -3.7038);

    // Expected bearing is roughly 250-260° (southwest)
    expect(bearing).toBeGreaterThan(245);
    expect(bearing).toBeLessThan(265);
  });

  test('calculates bearing due north', () => {
    const bearing = calculateBearing(41.0, 2.0, 42.0, 2.0);

    // Due north should be close to 0° (allowing for small numerical error)
    expect(bearing).toBeCloseTo(0, 0);
  });

  test('calculates bearing due east', () => {
    const bearing = calculateBearing(41.0, 2.0, 41.0, 3.0);

    // Due east should be close to 90°
    expect(bearing).toBeCloseTo(90, 0);
  });

  test('calculates bearing due south', () => {
    const bearing = calculateBearing(42.0, 2.0, 41.0, 2.0);

    // Due south should be close to 180°
    expect(bearing).toBeCloseTo(180, 0);
  });

  test('calculates bearing due west', () => {
    const bearing = calculateBearing(41.0, 3.0, 41.0, 2.0);

    // Due west should be close to 270°
    expect(bearing).toBeCloseTo(270, 0);
  });

  test('calculates bearing for Barcelona train stations', () => {
    // Sants to Passeig de Gràcia (roughly northeast)
    const bearing = calculateBearing(
      41.3793, 2.1404,  // Sants
      41.3904, 2.1636   // Passeig de Gràcia
    );

    // Expected bearing is roughly 45-75° (northeast)
    expect(bearing).toBeGreaterThan(40);
    expect(bearing).toBeLessThan(80);
  });

  test('returns value in range [0, 360)', () => {
    const testCases = [
      [0, 0, 1, 1],
      [50, 50, -50, -50],
      [-20, -20, 20, 20],
      [41.3851, 2.1734, 40.4168, -3.7038],
    ];

    testCases.forEach(([lat1, lng1, lat2, lng2]) => {
      const bearing = calculateBearing(lat1, lng1, lat2, lng2);
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
    });
  });

  test('handles same position (returns 0)', () => {
    const bearing = calculateBearing(41.3851, 2.1734, 41.3851, 2.1734);
    expect(bearing).toBe(0);
  });
});

describe('interpolatePosition', () => {
  test('returns start position when t = 0', () => {
    const start: Position = [2.1734, 41.3851];
    const end: Position = [2.1800, 41.3900];

    const result = interpolatePosition(start, end, 0);

    expect(result[0]).toBeCloseTo(start[0], 6);
    expect(result[1]).toBeCloseTo(start[1], 6);
  });

  test('returns end position when t = 1', () => {
    const start: Position = [2.1734, 41.3851];
    const end: Position = [2.1800, 41.3900];

    const result = interpolatePosition(start, end, 1);

    expect(result[0]).toBeCloseTo(end[0], 6);
    expect(result[1]).toBeCloseTo(end[1], 6);
  });

  test('returns midpoint when t = 0.5', () => {
    const start: Position = [2.0, 41.0];
    const end: Position = [4.0, 43.0];

    const result = interpolatePosition(start, end, 0.5);

    expect(result[0]).toBeCloseTo(3.0, 6);
    expect(result[1]).toBeCloseTo(42.0, 6);
  });

  test('interpolates at t = 0.25', () => {
    const start: Position = [0.0, 0.0];
    const end: Position = [4.0, 8.0];

    const result = interpolatePosition(start, end, 0.25);

    expect(result[0]).toBeCloseTo(1.0, 6);
    expect(result[1]).toBeCloseTo(2.0, 6);
  });

  test('interpolates at t = 0.75', () => {
    const start: Position = [0.0, 0.0];
    const end: Position = [4.0, 8.0];

    const result = interpolatePosition(start, end, 0.75);

    expect(result[0]).toBeCloseTo(3.0, 6);
    expect(result[1]).toBeCloseTo(6.0, 6);
  });

  test('clamps t values below 0 to 0', () => {
    const start: Position = [2.0, 41.0];
    const end: Position = [4.0, 43.0];

    const result = interpolatePosition(start, end, -0.5);

    expect(result[0]).toBeCloseTo(start[0], 6);
    expect(result[1]).toBeCloseTo(start[1], 6);
  });

  test('clamps t values above 1 to 1', () => {
    const start: Position = [2.0, 41.0];
    const end: Position = [4.0, 43.0];

    const result = interpolatePosition(start, end, 1.5);

    expect(result[0]).toBeCloseTo(end[0], 6);
    expect(result[1]).toBeCloseTo(end[1], 6);
  });

  test('handles negative coordinates', () => {
    const start: Position = [-3.7038, 40.4168];  // Madrid
    const end: Position = [-0.3763, 39.4699];    // Valencia

    const result = interpolatePosition(start, end, 0.5);

    const expectedLng = (-3.7038 + -0.3763) / 2;
    const expectedLat = (40.4168 + 39.4699) / 2;

    expect(result[0]).toBeCloseTo(expectedLng, 6);
    expect(result[1]).toBeCloseTo(expectedLat, 6);
  });

  test('handles very small movements', () => {
    const start: Position = [2.173400, 41.385100];
    const end: Position = [2.173401, 41.385101];

    const result = interpolatePosition(start, end, 0.5);

    expect(result[0]).toBeCloseTo(2.1734005, 6);
    expect(result[1]).toBeCloseTo(41.3851005, 6);
  });
});

describe('easeInOutCubic', () => {
  test('returns 0 when t = 0', () => {
    expect(easeInOutCubic(0)).toBe(0);
  });

  test('returns 1 when t = 1', () => {
    expect(easeInOutCubic(1)).toBe(1);
  });

  test('returns 0.5 when t = 0.5', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
  });

  test('accelerates in first half (t < 0.5)', () => {
    const t1 = 0.1;
    const t2 = 0.2;
    const t3 = 0.3;

    const result1 = easeInOutCubic(t1);
    const result2 = easeInOutCubic(t2);
    const result3 = easeInOutCubic(t3);

    // In ease-in phase, later increments should be larger
    const increment1 = result2 - result1;
    const increment2 = result3 - result2;

    expect(increment2).toBeGreaterThan(increment1);
  });

  test('decelerates in second half (t > 0.5)', () => {
    const t1 = 0.7;
    const t2 = 0.8;
    const t3 = 0.9;

    const result1 = easeInOutCubic(t1);
    const result2 = easeInOutCubic(t2);
    const result3 = easeInOutCubic(t3);

    // In ease-out phase, later increments should be smaller
    const increment1 = result2 - result1;
    const increment2 = result3 - result2;

    expect(increment2).toBeLessThan(increment1);
  });

  test('returns values in range [0, 1]', () => {
    for (let t = 0; t <= 1; t += 0.05) {
      const result = easeInOutCubic(t);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });
});

describe('interpolatePositionSmooth', () => {
  test('applies easing to interpolation', () => {
    const start: Position = [0.0, 0.0];
    const end: Position = [10.0, 10.0];

    const linearResult = interpolatePosition(start, end, 0.5);
    const smoothResult = interpolatePositionSmooth(start, end, 0.5);

    // At t=0.5, easing returns 0.5, so results should be the same
    expect(smoothResult[0]).toBeCloseTo(linearResult[0], 6);
    expect(smoothResult[1]).toBeCloseTo(linearResult[1], 6);
  });

  test('smooth interpolation differs from linear at t=0.25', () => {
    const start: Position = [0.0, 0.0];
    const end: Position = [10.0, 10.0];

    const linearResult = interpolatePosition(start, end, 0.25);
    const smoothResult = interpolatePositionSmooth(start, end, 0.25);

    // Eased t should be less than linear t in ease-in phase
    expect(smoothResult[0]).toBeLessThan(linearResult[0]);
    expect(smoothResult[1]).toBeLessThan(linearResult[1]);
  });

  test('smooth interpolation differs from linear at t=0.75', () => {
    const start: Position = [0.0, 0.0];
    const end: Position = [10.0, 10.0];

    const linearResult = interpolatePosition(start, end, 0.75);
    const smoothResult = interpolatePositionSmooth(start, end, 0.75);

    // Eased t should be greater than linear t in ease-out phase
    expect(smoothResult[0]).toBeGreaterThan(linearResult[0]);
    expect(smoothResult[1]).toBeGreaterThan(linearResult[1]);
  });

  test('returns start position when t = 0', () => {
    const start: Position = [2.1734, 41.3851];
    const end: Position = [2.1800, 41.3900];

    const result = interpolatePositionSmooth(start, end, 0);

    expect(result[0]).toBeCloseTo(start[0], 6);
    expect(result[1]).toBeCloseTo(start[1], 6);
  });

  test('returns end position when t = 1', () => {
    const start: Position = [2.1734, 41.3851];
    const end: Position = [2.1800, 41.3900];

    const result = interpolatePositionSmooth(start, end, 1);

    expect(result[0]).toBeCloseTo(end[0], 6);
    expect(result[1]).toBeCloseTo(end[1], 6);
  });
});
