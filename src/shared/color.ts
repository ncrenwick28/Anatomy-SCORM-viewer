/** Colour helpers used for accent-colour validation (WCAG 2.x contrast). */

export function parseHex(input: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function isValidHex(input: string): boolean {
  return parseHex(input) !== null;
}

export function normaliseHex(input: string, fallback = '#0b6e8a'): string {
  const rgb = parseHex(input);
  if (!rgb) return fallback;
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever has the stronger contrast against `background`. */
export function readableTextOn(background: string): '#ffffff' | '#0f1b24' {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#0f1b24') ? '#ffffff' : '#0f1b24';
}

/** Mix a colour with white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  const target = amount >= 0 ? 255 : 0;
  const a = Math.min(1, Math.abs(amount));
  return '#' + rgb.map((v) => Math.round(v + (target - v) * a).toString(16).padStart(2, '0')).join('');
}

export function toRgbaString(hex: string, alpha: number): string {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export interface AccentTheme {
  accent: string;
  /** Accent darkened (if needed) so it reads as text/icons on white (≥ 4.5:1). */
  ink: string;
  contrast: string;
  soft: string;
  softBorder: string;
}

/** Derives the CSS colour variables for a chosen accent colour, guaranteeing readable text on it. */
export function accentTheme(accentInput: string): AccentTheme {
  const accent = normaliseHex(accentInput);
  const soft = shade(accent, 0.9);
  let ink = accent;
  let n = 0;
  // The "ink" is used as text on white, on the soft tint (chips, selected rows) and on the light greys behind hovered
  // tabs and rows (#e3e9ee is the darkest), so it must reach 4.5:1 on all of them.
  while ((contrastRatio(ink, '#ffffff') < 4.5 || contrastRatio(ink, soft) < 4.5 || contrastRatio(ink, '#e3e9ee') < 4.5) && n++ < 40) ink = shade(ink, -0.06);
  return { accent, ink, contrast: readableTextOn(accent), soft, softBorder: shade(accent, 0.7) };
}

export function themeStyle(accent: string): Record<string, string> {
  const t = accentTheme(accent);
  return { '--accent': t.accent, '--accent-ink': t.ink, '--focus': t.ink, '--accent-contrast': t.contrast, '--accent-soft': t.soft, '--accent-soft-border': t.softBorder, '--av-accent': t.accent, '--av-accent-contrast': t.contrast };
}
