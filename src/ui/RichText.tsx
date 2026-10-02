import { Fragment, type ReactNode } from 'react';
import { parseRichText, type Inline } from '../shared/richtext';

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={i}>{n.v}</Fragment>;
      case 'br':
        return <br key={i} />;
      case 'strong':
        return <strong key={i}>{renderInline(n.c)}</strong>;
      case 'em':
        return <em key={i}>{renderInline(n.c)}</em>;
      case 'link':
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
            {renderInline(n.c)}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        );
    }
  });
}

/** Renders author text through the safe rich-text parser. No HTML is ever interpreted. */
export function RichText({ text, className = '' }: { text: string; className?: string }) {
  const blocks = parseRichText(text);
  if (!blocks.length) return null;
  return (
    <div className={`rich ${className}`}>
      {blocks.map((b, i) =>
        b.t === 'p' ? (
          <p key={i}>{renderInline(b.c)}</p>
        ) : b.t === 'ul' ? (
          <ul key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>
        ) : (
          <ol key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ol>
        ),
      )}
    </div>
  );
}
