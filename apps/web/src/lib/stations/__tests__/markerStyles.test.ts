import { describe, it, expect } from 'vitest';
import {
  getStationMarkerStyles,
  getMultiLineInnerCircleStyles,
} from '../markerStyles';

describe('markerStyles', () => {
  describe('getStationMarkerStyles', () => {
    it('should use zoom-based opacity', () => {
      const styles = getStationMarkerStyles(false, false);

      expect(styles['circle-opacity']).toEqual([
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        0,
        15,
        1,
      ]);
    });

    it('should use white stroke when not highlighted', () => {
      const styles = getStationMarkerStyles(false, false);

      expect(styles['circle-stroke-color']).toBe('#FFFFFF');
    });

    it('should use gold stroke when highlighted', () => {
      const styles = getStationMarkerStyles(true, false);

      expect(styles['circle-stroke-color']).toBe('#FFD700');
    });

    it('should include zoom-interpolated radius', () => {
      const styles = getStationMarkerStyles(false, false);

      expect(styles['circle-radius']).toBeDefined();
      expect(Array.isArray(styles['circle-radius'])).toBe(true);

      // Check structure: ['interpolate', ['linear'], ['zoom'], ...]
      expect(styles['circle-radius'][0]).toBe('interpolate');
      expect(styles['circle-radius'][1]).toEqual(['linear']);
      expect(styles['circle-radius'][2]).toEqual(['zoom']);
    });

    it('should differentiate single-line vs multi-line marker radius', () => {
      const styles = getStationMarkerStyles(false, false);

      const radiusExpression = styles['circle-radius'];

      // At zoom 10
      expect(radiusExpression[3]).toBe(10);
      expect(radiusExpression[4]).toEqual(['case', ['get', 'isMultiLine'], 18, 15]);

      // At zoom 15
      expect(radiusExpression[5]).toBe(15);
      expect(radiusExpression[6]).toEqual(['case', ['get', 'isMultiLine'], 22, 16]);

      // At zoom 18.5
      expect(radiusExpression[7]).toBe(18.5);
      expect(radiusExpression[8]).toEqual(['case', ['get', 'isMultiLine'], 30, 22]);
    });

    it('should use black fill color for consistency', () => {
      const styles = getStationMarkerStyles(false, false);

      expect(styles['circle-color']).toBe('#000000');
    });

    it('should keep markers grounded so trains appear to dock on top', () => {
      const styles = getStationMarkerStyles(false, false);

      expect(styles['circle-translate']).toEqual(['literal', [0, 0]]);
    });

    it('should differentiate stroke width for multi-line stations', () => {
      const styles = getStationMarkerStyles(false, false);

      expect(styles['circle-stroke-width']).toEqual([
        'case',
        ['get', 'isMultiLine'],
        3,
        2,
      ]);
    });

    it('should support both highlighted and dimmed states simultaneously', () => {
      const styles = getStationMarkerStyles(true, true);

      expect(styles['circle-opacity']).toEqual([
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        0,
        15,
        0.3,
      ]);
      expect(styles['circle-stroke-color']).toBe('#FFD700');
    });
  });

  describe('getMultiLineInnerCircleStyles', () => {
    it('should return white fill color', () => {
      const styles = getMultiLineInnerCircleStyles();

      expect(styles['circle-color']).toBe('#FFFFFF');
    });

    it('should use zoom-based opacity for inner circle', () => {
      const styles = getMultiLineInnerCircleStyles();

      expect(styles['circle-opacity']).toEqual([
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        0,
        15,
        1,
      ]);
    });

    it('should use black stroke color aligned with outer marker', () => {
      const styles = getMultiLineInnerCircleStyles();

      expect(styles['circle-stroke-color']).toBe('#000000');
    });

    it('should have thin stroke width', () => {
      const styles = getMultiLineInnerCircleStyles();

      expect(styles['circle-stroke-width']).toBe(1);
    });

    it('should include zoom-interpolated radius', () => {
      const styles = getMultiLineInnerCircleStyles();

      expect(styles['circle-radius']).toBeDefined();
      expect(Array.isArray(styles['circle-radius'])).toBe(true);

      // Check structure
      expect(styles['circle-radius'][0]).toBe('interpolate');
      expect(styles['circle-radius'][1]).toEqual(['linear']);
      expect(styles['circle-radius'][2]).toEqual(['zoom']);
    });

    it('should have smaller radius than outer circle', () => {
      const outerStyles = getStationMarkerStyles(false, false);
      const innerStyles = getMultiLineInnerCircleStyles();

      // At zoom 8: outer = 5 (multi-line), inner = 3
      // At zoom 16: outer = 14 (multi-line), inner = 9

      const outerRadius = outerStyles['circle-radius'];
      const innerRadius = innerStyles['circle-radius'];

      // Check zoom 10
      expect(outerRadius[3]).toBe(10);
      expect(outerRadius[4]).toEqual(['case', ['get', 'isMultiLine'], 18, 15]);

      expect(innerRadius[3]).toBe(10);
      expect(innerRadius[4]).toBe(10);

      // Check zoom 15
      expect(outerRadius[5]).toBe(15);
      expect(outerRadius[6]).toEqual(['case', ['get', 'isMultiLine'], 22, 16]);

      expect(innerRadius[5]).toBe(15);
      expect(innerRadius[6]).toBe(12);

      // Check zoom 18.5
      expect(outerRadius[7]).toBe(18.5);
      expect(outerRadius[8]).toEqual(['case', ['get', 'isMultiLine'], 30, 22]);

      expect(innerRadius[7]).toBe(18.5);
      expect(innerRadius[8]).toBe(16);
    });

    it('should create concentric circle effect with outer styles', () => {
      const outerStyles = getStationMarkerStyles(false, false);
      const innerStyles = getMultiLineInnerCircleStyles();

      // Outer: colored circle with stroke
      expect(outerStyles['circle-color']).toBe('#000000');
      expect(outerStyles['circle-stroke-width']).toEqual([
        'case',
        ['get', 'isMultiLine'],
        3,
        2,
      ]);

      // Inner: white circle with colored stroke
      expect(innerStyles['circle-color']).toBe('#FFFFFF');
      expect(innerStyles['circle-stroke-color']).toBe('#000000');

      // This creates a "donut" visual effect
    });
  });

  describe('integration', () => {
    it('should return consistent property structures', () => {
      const outerStyles = getStationMarkerStyles(false, false);
      const innerStyles = getMultiLineInnerCircleStyles();

      // Both should have all required circle paint properties
      const requiredProps = [
        'circle-radius',
        'circle-color',
        'circle-opacity',
        'circle-stroke-width',
        'circle-stroke-color',
        'circle-translate',
      ];

      requiredProps.forEach((prop) => {
        expect(outerStyles).toHaveProperty(prop);
        expect(innerStyles).toHaveProperty(prop);
      });
    });

    it('should support all highlight/dim combinations', () => {
      const cases = [
        { highlighted: false, dimmed: false },
        { highlighted: true, dimmed: false },
        { highlighted: false, dimmed: true },
        { highlighted: true, dimmed: true },
      ];

      cases.forEach(({ highlighted, dimmed }) => {
        const styles = getStationMarkerStyles(highlighted, dimmed);

        expect(styles['circle-opacity']).toEqual([
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          0,
          15,
          dimmed ? 0.3 : 1.0,
        ]);
        expect(styles['circle-stroke-color']).toBe(
          highlighted ? '#FFD700' : '#FFFFFF'
        );
      });
    });
  });
});
