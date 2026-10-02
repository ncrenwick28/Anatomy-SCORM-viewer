import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, Crosshair, EyeOff, ExternalLink, Search, X } from 'lucide-react';
import type { Annotation } from '../shared/types';
import { sanitiseUrl, toPlainText } from '../shared/richtext';
import type { MarkerState } from '../viewer/types';
import { RichText } from './RichText';

export interface AnnotationListProps {
  annotations: Annotation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  states: Record<string, MarkerState>;
  viewed?: Set<string>;
  /** Names are hidden (self-study) unless revealed. */
  isConcealed?: (a: Annotation) => boolean;
  searchable?: boolean;
  empty?: ReactNode;
  idPrefix?: string;
}

/** Searchable, keyboard-navigable annotation list (ArrowUp/Down, Home/End). */
export function AnnotationList({ annotations, selectedId, onSelect, states, viewed, isConcealed, searchable = true, empty, idPrefix = 'ann' }: AnnotationListProps) {
  const [q, setQ] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const [cat, setCat] = useState<string | null>(null);
  const categories = useMemo(() => [...new Set(annotations.map((a) => a.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [annotations]);
  const anyConcealed = !!isConcealed && annotations.some((a) => isConcealed(a));

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return annotations
      .map((a, i) => ({ a, i }))
      .filter(({ a, i }) => {
        if (cat && a.category !== cat) return false;
        if (!needle) return true;
        if (String(i + 1) === needle) return true;
        if (isConcealed?.(a)) return false; // searching must not leak concealed names
        return a.label.toLowerCase().includes(needle) || a.category.toLowerCase().includes(needle) || toPlainText(a.description).toLowerCase().includes(needle);
      });
  }, [annotations, q, cat, isConcealed]);

  // Keep the selected row visible when selection comes from the model or the detail card's Next/Previous.
  useEffect(() => {
    if (!selectedId) return;
    const el = listRef.current?.querySelector<HTMLElement>('.ann-item.is-selected');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, rows.length]);

  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button.ann-item') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = Math.min(items.length - 1, idx + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, idx - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      items[next]?.focus();
    }
  };

  return (
    <div className="ann-list">
      {searchable && annotations.length > 3 && (
        <div className="ann-search">
          <Search size={16} aria-hidden="true" />
          <label className="sr-only" htmlFor={`${idPrefix}-search`}>Search annotations</label>
          <input id={`${idPrefix}-search`} className="input" type="search" placeholder={anyConcealed ? 'Search by number…' : 'Search annotations…'} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      {categories.length > 1 && !anyConcealed && (
        <div className="ann-cats" role="group" aria-label="Filter by category">
          <button type="button" className="chip" aria-pressed={cat === null} onClick={() => setCat(null)}>All</button>
          {categories.map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>{c}</button>
          ))}
        </div>
      )}
      {!annotations.length ? (
        <div className="ann-empty">{empty ?? 'No annotations yet.'}</div>
      ) : !rows.length ? (
        <div className="ann-empty" role="status">No annotations match your search.</div>
      ) : (
        <ul className="ann-items" ref={listRef} onKeyDown={onKey} aria-label={`Annotations, ${rows.length} shown`}>
          {rows.map(({ a, i }) => {
            const hidden = isConcealed?.(a) ?? false;
            const st = states[a.id];
            const selected = a.id === selectedId;
            return (
              <li key={a.id}>
                <button type="button" id={`${idPrefix}-item-${a.id}`} className={`ann-item ${selected ? 'is-selected' : ''}`} aria-current={selected ? 'true' : undefined} onClick={() => onSelect(a.id)}>
                  <span className="ann-num" aria-hidden="true">{i + 1}</span>
                  <span className="ann-text">
                    <span className="ann-label">{hidden ? `Structure ${i + 1}` : a.label}</span>
                    {!hidden && a.category && <span className="ann-cat">{a.category}</span>}
                  </span>
                  <span className="ann-flags">
                    {viewed?.has(a.id) && <span title="Viewed" className="ann-flag ann-flag--ok"><Check size={15} aria-hidden="true" /><span className="sr-only">Viewed</span></span>}
                    {(st === 'occluded' || st === 'structure-hidden') && (
                      <span className="ann-flag" title={st === 'occluded' ? 'Hidden behind the surface from this angle' : 'Its structure is hidden'}>
                        <EyeOff size={15} aria-hidden="true" />
                        <span className="sr-only">{st === 'occluded' ? 'Hidden behind the surface from this angle' : 'Structure hidden'}</span>
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export interface AnnotationDetailProps {
  annotation: Annotation;
  index: number;
  total: number;
  concealed: boolean;
  onReveal?: () => void;
  state?: MarkerState;
  onPrev?: () => void;
  onNext?: () => void;
  onClose?: () => void;
  onFocusOnModel?: () => void;
  onShowStructure?: () => void;
  actions?: ReactNode;
  showRequired?: boolean;
}

/** The information panel for the selected annotation. Stays beside the list so the learner never loses their place. */
export function AnnotationDetail({ annotation: a, index, total, concealed, onReveal, state, onPrev, onNext, onClose, onFocusOnModel, onShowStructure, actions, showRequired }: AnnotationDetailProps) {
  const link = a.link && sanitiseUrl(a.link.url);
  return (
    <section className="ann-detail" aria-label="Annotation details" aria-live="polite" aria-atomic="true" tabIndex={-1} data-testid="annotation-detail">
      <header className="ann-detail__head">
        <span className="ann-num ann-num--lg" aria-hidden="true">{index + 1}</span>
        <div className="ann-detail__title">
          <h3>{concealed ? `Structure ${index + 1}` : a.label}</h3>
          <div className="ann-detail__meta">
            <span className="hint">{index + 1} of {total}</span>
            {!concealed && a.category && <span className="chip chip--accent">{a.category}</span>}
            {showRequired && !a.required && <span className="chip">Optional</span>}
          </div>
        </div>
        {onClose && (
          <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label="Close annotation details" title="Close"><X /></button>
        )}
      </header>
      {state === 'occluded' && (
        <div className="callout callout--info ann-note" role="note">
          <EyeOff aria-hidden="true" />
          <span>This point is on a hidden side of the model.{onFocusOnModel && ' Turn the model to bring it into view.'}</span>
          {onFocusOnModel && <button type="button" className="btn btn--sm" onClick={onFocusOnModel}><Crosshair /> Turn to it</button>}
        </div>
      )}
      {state === 'structure-hidden' && (
        <div className="callout callout--warn ann-note" role="note">
          <EyeOff aria-hidden="true" />
          <span>The structure this marker sits on is currently hidden.</span>
          {onShowStructure && <button type="button" className="btn btn--sm" onClick={onShowStructure}>Show structures</button>}
        </div>
      )}
      <div className="ann-detail__body">
        {concealed ? (
          <div className="ann-conceal">
            <p>Name and description are hidden for self-study. Can you identify structure {index + 1}?</p>
            <button type="button" className="btn btn--primary" onClick={onReveal}>Reveal name and description</button>
          </div>
        ) : (
          <>
            {a.description.trim() ? <RichText text={a.description} /> : <p className="hint">No description has been added for this annotation.</p>}
            {link && a.link && (
              <p className="ann-link">
                <a href={link} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={15} aria-hidden="true" /> {a.link.title || link}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </p>
            )}
          </>
        )}
      </div>
      <footer className="ann-detail__foot">
        <div className="ann-nav">
          <button type="button" className="btn btn--sm" onClick={onPrev} disabled={!onPrev}><ChevronLeft /> Previous</button>
          <button type="button" className="btn btn--sm" onClick={onNext} disabled={!onNext}>Next <ChevronRight /></button>
        </div>
        {onFocusOnModel && state !== 'occluded' && state !== 'structure-hidden' && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onFocusOnModel} title="Centre the view on this marker"><Crosshair /> Centre on model</button>
        )}
        {actions}
      </footer>
    </section>
  );
}
