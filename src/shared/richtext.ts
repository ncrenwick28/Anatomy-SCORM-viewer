/**
 * A deliberately tiny, safe rich-text format for descriptions.
 *
 * Authors type plain text. These conventions add readable structure:
 *   - blank line  → new paragraph        - single newline → line break
 *   - "- " / "* " → bullet list          - "1. "          → numbered list
 *   - **bold**, *italic* / _italic_      - [text](https://example.org), or a bare http(s) URL
 *
 * The parser produces a small AST that the UI renders with ordinary React elements. HTML typed by an
 * author is never interpreted: `<script>` is displayed as the literal text "<script>". Links are
 * restricted to http(s). There is no innerHTML anywhere in the pipeline.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] };

/** Returns a normalised http(s) URL, or null if the URL is empty, malformed or uses another scheme. */
export function sanitiseUrl(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || /[\u0000-\u001f\u007f\s]/.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const URL_RE = /https?:\/\/[^\s<>()\[\]"']+[^\s<>()\[\]"'.,;:!?]/y;

function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      out.push({ t: 'text', v: buf });
      buf = '';
    }
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length && '*_[]()\\'.includes(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\n') {
      flush();
      out.push({ t: 'br' });
      i++;
      continue;
    }
    if (ch === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && src[i + 1] !== ch && src[i + 1] !== ' ' && src[i + 1] !== undefined) {
      // Underscore emphasis only at word boundaries so snake_case stays intact.
      const prev = i > 0 ? src[i - 1] : ' ';
      // Underscore emphasis needs a clear word boundary before it (never inside identifiers such as window.__x).
      if (ch === '*' || /[\s([{"'“]/.test(prev) || i === 0) {
        const end = src.indexOf(ch, i + 1);
        if (end > i + 1 && src[end - 1] !== ' ' && (ch === '*' || !/[A-Za-z0-9]/.test(src[end + 1] ?? ' '))) {
          flush();
          out.push({ t: 'em', c: parseInline(src.slice(i + 1, end)) });
          i = end + 1;
          continue;
        }
      }
    }
    if (ch === '[') {
      const close = src.indexOf('](', i + 1);
      if (close > i) {
        const end = src.indexOf(')', close + 2);
        if (end > close) {
          const href = sanitiseUrl(src.slice(close + 2, end));
          const text = src.slice(i + 1, close);
          if (href && text.trim()) {
            flush();
            out.push({ t: 'link', href, c: [{ t: 'text', v: text }] });
            i = end + 1;
            continue;
          }
        }
      }
    }
    if (ch === 'h' && (src.startsWith('http://', i) || src.startsWith('https://', i)) && !/["'=<]/.test(i > 0 ? src[i - 1] : ' ')) {
      URL_RE.lastIndex = i;
      const m = URL_RE.exec(src);
      if (m) {
        const href = sanitiseUrl(m[0]);
        if (href) {
          flush();
          out.push({ t: 'link', href, c: [{ t: 'text', v: m[0] }] });
          i += m[0].length;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

export function parseRichText(text: string): Block[] {
  const normalised = (text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!normalised) return [];
  const blocks: Block[] = [];
  for (const chunk of normalised.split(/\n{2,}/)) {
    const lines = chunk.split('\n');
    let i = 0;
    let para: string[] = [];
    const flushPara = () => {
      if (para.length) {
        blocks.push({ t: 'p', c: parseInline(para.join('\n')) });
        para = [];
      }
    };
    while (i < lines.length) {
      const ul = /^\s*[-*•]\s+(.*)$/.exec(lines[i]);
      const ol = /^\s*\d+[.)]\s+(.*)$/.exec(lines[i]);
      if (ul || ol) {
        flushPara();
        const ordered = !!ol;
        const items: Inline[][] = [];
        while (i < lines.length) {
          const m = ordered ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[i]) : /^\s*[-*•]\s+(.*)$/.exec(lines[i]);
          if (!m) break;
          items.push(parseInline(m[1]));
          i++;
        }
        blocks.push(ordered ? { t: 'ol', items } : { t: 'ul', items });
      } else {
        para.push(lines[i]);
        i++;
      }
    }
    flushPara();
  }
  return blocks;
}

/** Plain-text rendering (used for search indexing and aria labels). */
export function toPlainText(text: string): string {
  const flat = (inl: Inline[]): string =>
    inl
      .map((n) => {
        switch (n.t) {
          case 'text':
            return n.v;
          case 'br':
            return ' ';
          default:
            return flat(n.c);
        }
      })
      .join('');
  return parseRichText(text)
    .map((b) => (b.t === 'p' ? flat(b.c) : b.items.map(flat).join('; ')))
    .join(' ');
}
