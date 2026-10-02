import { describe, expect, it } from 'vitest';
import { accentTheme, contrastRatio, isValidHex, normaliseHex, readableTextOn } from '../../src/shared/color';

describe('colour helpers', () => {
  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#ffffff')).toBeGreaterThan(4.4);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.6);
  });
  it('validates and normalises hex', () => {
    expect(isValidHex('#0b6e8a')).toBe(true);
    expect(isValidHex('#abc')).toBe(true);
    expect(isValidHex('red')).toBe(false);
    expect(normaliseHex('#ABC')).toBe('#aabbcc');
    expect(normaliseHex('nonsense', '#111111')).toBe('#111111');
  });
  it('derives an accent "ink" that reads on white and on the accent tint, even for extreme accents', () => {
    for (const hex of ['#0b6e8a', '#ffe600', '#847508', '#ffffff', '#000000', '#7fffd4', '#ff69b4', '#f0e68c']) {
      const t = accentTheme(hex);
      expect(contrastRatio(t.ink, '#ffffff'), `${hex} ink on white`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.ink, t.soft), `${hex} ink on soft`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.accent, t.contrast), `${hex} text on accent`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('chooses a readable text colour', () => {
    expect(readableTextOn('#ffffff')).toBe('#0f1b24');
    expect(readableTextOn('#0b3a4f')).toBe('#ffffff');
  });
});
