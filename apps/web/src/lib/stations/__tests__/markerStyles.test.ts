import { describe, it, expect } from 'vitest';
import {
  getStationMarkerStyles,
  getMultiLineInnerCircleStyles,
} from '../markerStyles';

describe('markerStyles', () => {
  describe('getStationMarkerStyles', () => {
    it('should return normal opacity when not dimmed', () => {
      const styles = getStationMarkerStyles(false, false);

      expect(styles['circle-opacity']).toBe(1.0);
    });

    it('should return reduced opacity when dimmed', () => {
      const styles = getStationMarkerStyles(false, true);

      expect(styles['circle-opacity']).toBe(0.3);
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

      // Check structure: ['interpolate', ['exponential', 1.5], ['zoom'], ...]
      expect(styles['circle-radius'][0]).toBe('interpolate');
      expect(styles['circle-radius'][1]).toEqual(['exponential', 1.5]);
      expect(styles['circle-radius'][2]).toEqual(['zoom']);
    });

    it('should differentiate single-line vs multi-line marker radius', () => {
      const styles = getStationMarkerStyles(false, false);

      const radiusExpression = styles['circle-radius'];

      // Structure: ['interpolate', ['exponential', 1.5], ['zoom'],
      //             8, ['case', ['get', 'isMultiLine'], 5, 4],
      //             16, ['case', ['get', 'isMultiLine'], 14, 12]]

      // At zoom 8
      expect(radiusExpression[3]).toBe(8);
      expect(radiusExpression[4]).toEqual(['case', ['get', 'isMultiLine'], 5, 4]);

      // At zoom 16
      expect(radiusExpression[5]).toBe(16);
      expect(radiusExpression[6]).toEqual(['case', ['get', 'isMultiLine'], 14, 12]);
    });

    it('should use data-driven color from dominantLineColor property', () => {
      const styles = getStationMarkerStyles(false, false);

      expect(styles['circle-color']).toEqual(['get', 'dominantLineColor']);
    });

    it('should differentiate stroke width for multi-line stations', () => {
      const styles = getStationMarkerStyles(false, false);

      expect(styles['circle-stroke-width']).toEqual([
        'case',
        ['get', 'isMultiLine'],
        2,
        1,
      ]);
    });

    it('should support both highlighted and dimmed states simultaneously', () => {
      const styles = getStationMarkerStyles(true, true);

      expect(styles['circle-opacity']).toBe(0.3);
      expect(styles['circle-stroke-color']).toBe('#FFD700');
    });
  });

  describe('getMultiLineInnerCircleStyles', () => {
    it('should return white fill color', () => {
      const styles = getMultiLineInnerCircleStyles();

      expect(styles['circle-color']).toBe('#FFFFFF');
    });

    it('should return full opacity', () => {
      const styles = getMultiLineInnerCircleStyles();

      expect(styles['circle-opacity']).toBe(1.0);
    });

    it('should use data-driven stroke color from dominantLineColor', () => {
      const styles = getMultiLineInnerCircleStyles();

      expect(styles['circle-stroke-color']).toEqual(['get', 'dominantLineColor']);
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
      expect(styles['circle-radius'][1]).toEqual(['exponential', 1.5]);
      expect(styles['circle-radius'][2]).toEqual(['zoom']);
    });

    it('should have smaller radius than outer circle', () => {
      const outerStyles = getStationMarkerStyles(false, false);
      const innerStyles = getMultiLineInnerCircleStyles();

      // At zoom 8: outer = 5 (multi-line), inner = 3
      // At zoom 16: outer = 14 (multi-line), inner = 9

      const outerRadius = outerStyles['circle-radius'];
      const innerRadius = innerStyles['circle-radius'];

      // Check zoom 8
      expect(outerRadius[3]).toBe(8);
      expect(outerRadius[4]).toEqual(['case', ['get', 'isMultiLine'], 5, 4]);

      expect(innerRadius[3]).toBe(8);
      expect(innerRadius[4]).toBe(3);

      // Check zoom 16
      expect(outerRadius[5]).toBe(16);
      expect(outerRadius[6]).toEqual(['case', ['get', 'isMultiLine'], 14, 12]);

      expect(innerRadius[5]).toBe(16);
      expect(innerRadius[6]).toBe(9);
    });

    it('should create concentric circle effect with outer styles', () => {
      const outerStyles = getStationMarkerStyles(false, false);
      const innerStyles = getMultiLineInnerCircleStyles();

      // Outer: colored circle with stroke
      expect(outerStyles['circle-color']).toEqual(['get', 'dominantLineColor']);
      expect(outerStyles['circle-stroke-width']).toEqual([
        'case',
        ['get', 'isMultiLine'],
        2,
        1,
      ]);

      // Inner: white circle with colored stroke
      expect(innerStyles['circle-color']).toBe('#FFFFFF');
      expect(innerStyles['circle-stroke-color']).toEqual([
        'get',
        'dominantLineColor',
      ]);

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

        expect(styles['circle-opacity']).toBe(dimmed ? 0.3 : 1.0);
        expect(styles['circle-stroke-color']).toBe(
          highlighted ? '#FFD700' : '#FFFFFF'
        );
      });
    });
  });
});
