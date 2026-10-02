import { describe, expect, it } from 'vitest';
import { contrastRatio, isValidHex, normaliseHex, readableTextOn } from '../../src/shared/color';

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
  it('chooses a readable text colour', () => {
    expect(readableTextOn('#ffffff')).toBe('#0f1b24');
    expect(readableTextOn('#0b3a4f')).toBe('#ffffff');
  });
});
