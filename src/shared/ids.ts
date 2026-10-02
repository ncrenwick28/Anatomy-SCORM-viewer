/** Short random ids. Uses getRandomValues so it also works on non-secure (plain http) origins. */
export function newId(prefix = ''): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(36).padStart(2, '0');
  return prefix ? `${prefix}-${out.slice(0, 12)}` : out.slice(0, 12);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Small, stable, non-cryptographic hash (FNV-1a, 32-bit) rendered as base36. */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

/** Lower-case ASCII slug for file and identifier use. */
export function slugify(input: string, fallback = 'item'): string {
  const s = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || fallback;
}
