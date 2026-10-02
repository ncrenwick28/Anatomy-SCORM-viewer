import { describe, expect, it } from 'vitest';
import { parseRichText, sanitiseUrl, toPlainText, type Block, type Inline } from '../../src/shared/richtext';

const flatten = (inl: Inline[]): string[] => inl.flatMap((n) => (n.t === 'text' ? [n.v] : n.t === 'br' ? ['\n'] : [n.t + '(' + flatten(n.c).join('') + ')']));

describe('sanitiseUrl', () => {
  it('accepts http and https only', () => {
    expect(sanitiseUrl('https://example.org/a b'.replace(' ', '%20'))).toBe('https://example.org/a%20b');
    expect(sanitiseUrl('http://example.org')).toBe('http://example.org/');
    expect(sanitiseUrl('javascript:alert(1)')).toBeNull();
    expect(sanitiseUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(sanitiseUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(sanitiseUrl('vbscript:x')).toBeNull();
    expect(sanitiseUrl('ftp://example.org')).toBeNull();
    expect(sanitiseUrl('https://user:pw@example.org')).toBeNull();
    expect(sanitiseUrl('https://exa mple.org')).toBeNull();
    expect(sanitiseUrl('')).toBeNull();
    expect(sanitiseUrl('not a url')).toBeNull();
  });
});

describe('parseRichText', () => {
  it('splits paragraphs and keeps single newlines as line breaks', () => {
    const b = parseRichText('First line\nsecond line\n\nNew paragraph');
    expect(b).toHaveLength(2);
    expect(flatten((b[0] as Extract<Block, { t: 'p' }>).c)).toEqual(['First line', '\n', 'second line']);
  });
  it('parses bullet and numbered lists', () => {
    const b = parseRichText('Intro\n- one\n- two\n\n1. first\n2. second');
    expect(b.map((x) => x.t)).toEqual(['p', 'ul', 'ol']);
    expect((b[1] as Extract<Block, { t: 'ul' }>).items).toHaveLength(2);
  });
  it('parses bold, italic and links', () => {
    const b = parseRichText('A **bold** and *italic* and [site](https://example.org) word');
    const inl = (b[0] as Extract<Block, { t: 'p' }>).c;
    expect(inl.map((n) => n.t)).toEqual(['text', 'strong', 'text', 'em', 'text', 'link', 'text']);
    expect((inl[5] as Extract<Inline, { t: 'link' }>).href).toBe('https://example.org/');
  });
  it('auto-links bare URLs without swallowing trailing punctuation', () => {
    const b = parseRichText('See https://example.org/page.');
    const inl = (b[0] as Extract<Block, { t: 'p' }>).c;
    const link = inl.find((n) => n.t === 'link') as Extract<Inline, { t: 'link' }>;
    expect(link.href).toBe('https://example.org/page');
    expect((inl[inl.length - 1] as { v: string }).v).toBe('.');
  });
  it('never produces a link for unsafe schemes', () => {
    const b = parseRichText('[click](javascript:alert(1)) and [x](data:text/html;base64,AAAA)');
    const walk = (inl: Inline[]): Inline[] => inl.flatMap((n) => ('c' in n ? [n, ...walk(n.c)] : [n]));
    expect(walk((b[0] as Extract<Block, { t: 'p' }>).c).some((n) => n.t === 'link')).toBe(false);
  });
  it('treats HTML as literal text', () => {
    const b = parseRichText('<img src=x onerror=alert(1)> <script>alert(2)</script>');
    const inl = (b[0] as Extract<Block, { t: 'p' }>).c;
    expect(inl.every((n) => n.t === 'text')).toBe(true);
    expect(flatten(inl).join('')).toContain('<script>alert(2)</script>');
  });
  it('keeps snake_case words intact', () => {
    const b = parseRichText('the left_atrial_appendage here');
    expect((b[0] as Extract<Block, { t: 'p' }>).c.every((n) => n.t === 'text')).toBe(true);
  });
  it('does not turn code-like text into emphasis or links inside literal HTML', () => {
    const b = parseRichText('window.__pwned=1 and window.__pwned, plus <a href="https://evil.example/x">link</a>');
    const walk = (inl: Inline[]): Inline[] => inl.flatMap((n) => ('c' in n ? [n, ...walk(n.c)] : [n]));
    const nodes = walk((b[0] as Extract<Block, { t: 'p' }>).c);
    expect(nodes.some((n) => n.t === 'em' || n.t === 'strong')).toBe(false);
    expect(nodes.some((n) => n.t === 'link')).toBe(false); // the URL sits inside literal markup, so it stays text
    expect(parseRichText('a _real emphasis_ here')[0]).toMatchObject({ t: 'p' });
    const emph = walk((parseRichText('a _real emphasis_ here')[0] as Extract<Block, { t: 'p' }>).c);
    expect(emph.some((n) => n.t === 'em')).toBe(true);
  });
  it('returns nothing for empty text and plain text for search', () => {
    expect(parseRichText('   ')).toEqual([]);
    expect(toPlainText('A **b**\n- x\n- y')).toBe('A b x; y');
  });
});
