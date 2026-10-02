import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { PackageContent, PackageModel } from '../shared/content';
import { toPlainText } from '../shared/richtext';
import { RichText } from '../ui/RichText';
import { AssetImage } from '../ui/Assets';
import type { TrackerState } from './tracker';

interface Props {
  content: PackageContent;
  state: TrackerState;
  onOpen: (id: string) => void;
  restoreFocusId: string | null;
}

export function Gallery({ content, state, onOpen, restoreFocusId }: Props) {
  const f = content.features;
  const [q, setQ] = useState('');
  const [regionId, setRegionId] = useState<string | null>(null);
  const [systemId, setSystemId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const matches = (m: PackageModel, ignore?: 'region' | 'system') => {
    if (regionId && ignore !== 'region' && !m.regionIds.includes(regionId)) return false;
    if (systemId && ignore !== 'system' && !m.systemIds.includes(systemId)) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      m.title.toLowerCase().includes(needle) ||
      toPlainText(m.description).toLowerCase().includes(needle) ||
      m.annotations.some((a) => a.label.toLowerCase().includes(needle)) ||
      content.regions.some((r) => m.regionIds.includes(r.id) && r.name.toLowerCase().includes(needle)) ||
      content.systems.some((s) => m.systemIds.includes(s.id) && s.name.toLowerCase().includes(needle))
    );
  };
  const visible = useMemo(() => content.models.filter((m) => matches(m)), [content, q, regionId, systemId]);
  const count = (kind: 'region' | 'system', id: string) =>
    content.models.filter((m) => matches(m, kind) && (kind === 'region' ? m.regionIds.includes(id) : m.systemIds.includes(id))).length;
  const opened = new Set(state.progress.opened);
  const hasFilters = f.browseByCategory && (content.regions.length > 0 || content.systems.length > 0);
  const activeFilter = !!(q || regionId || systemId);
  const resumeModel = state.progress.lastModelId ? content.models.find((m) => m.id === state.progress.lastModelId) : null;

  return (
    <div className="pl-gallery">
      <section className="pl-hero" aria-labelledby="pl-hero-title">
        <h1 id="pl-hero-title" tabIndex={-1} className="pl-title">{content.title}</h1>
        {content.description && <RichText text={content.description} className="pl-lead" />}
        {content.intro && (
          <details className="pl-intro" open>
            <summary><ChevronDown aria-hidden="true" /> Introduction</summary>
            <RichText text={content.intro} />
          </details>
        )}
        {state.resumed && resumeModel && (
          <div className="callout callout--info pl-resume" role="status">
            <span>Welcome back. You were last looking at <strong>{resumeModel.title}</strong>.</span>
            <button type="button" className="btn btn--sm btn--primary" onClick={() => onOpen(resumeModel.id)}>Continue</button>
          </div>
        )}
        {state.contentChanged && (
          <div className="callout callout--warn" role="status"><span>This package has been updated (models or annotations were added, removed or reordered) since you last used it, so your earlier progress could not be restored.</span></div>
        )}
      </section>

      <div className={`pl-browse ${hasFilters ? 'has-filters' : ''}`}>
        {(f.search || hasFilters) && (
          <aside className="pl-filters" aria-label="Find models">
            {f.search && (
              <div className="pl-search">
                <Search size={17} aria-hidden="true" />
                <label className="sr-only" htmlFor="pl-q">Search models</label>
                <input id="pl-q" className="input" type="search" placeholder="Search models and structures…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            )}
            {hasFilters && (
              <>
                <button type="button" className="btn btn--sm pl-filters-toggle" aria-expanded={filtersOpen} aria-controls="pl-facets" onClick={() => setFiltersOpen((o) => !o)}>
                  Filter by region or system {(regionId || systemId) && <span className="chip chip--accent">{[regionId, systemId].filter(Boolean).length}</span>}
                </button>
                <div id="pl-facets" className={`pl-facets ${filtersOpen ? 'is-open' : ''}`}>
                  {content.regions.length > 0 && (
                    <fieldset>
                      <legend className="pl-facet-title">Body region</legend>
                      <div className="pl-chips">
                        <button type="button" className="chip" aria-pressed={regionId === null} onClick={() => setRegionId(null)}>All</button>
                        {content.regions.map((r) => (
                          <button key={r.id} type="button" className="chip" aria-pressed={regionId === r.id} onClick={() => setRegionId(regionId === r.id ? null : r.id)}>
                            {r.name} <span className="pl-count">{count('region', r.id)}</span>
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  {content.systems.length > 0 && (
                    <fieldset>
                      <legend className="pl-facet-title">Body system</legend>
                      <div className="pl-chips">
                        <button type="button" className="chip" aria-pressed={systemId === null} onClick={() => setSystemId(null)}>All</button>
                        {content.systems.map((s) => (
                          <button key={s.id} type="button" className="chip" aria-pressed={systemId === s.id} onClick={() => setSystemId(systemId === s.id ? null : s.id)}>
                            {s.name} <span className="pl-count">{count('system', s.id)}</span>
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </div>
              </>
            )}
          </aside>
        )}

        <section className="pl-results" aria-labelledby="pl-results-title">
          <div className="pl-results-head">
            <h2 id="pl-results-title">{activeFilter ? 'Matching models' : 'Models'}</h2>
            <span className="hint" role="status" aria-live="polite">{visible.length} of {content.models.length} shown</span>
            {activeFilter && <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setQ(''); setRegionId(null); setSystemId(null); }}>Clear filters</button>}
          </div>
          {visible.length === 0 ? (
            <div className="pl-empty">
              <p><strong>No models match.</strong></p>
              <p className="hint">Try a different search term or clear the filters.</p>
            </div>
          ) : (
            <ul className="pl-grid">
              {visible.map((m) => {
                const viewed = state.progress.viewed[m.id]?.length ?? 0;
                const required = m.annotations.filter((a) => a.required).length;
                const regionNames = content.regions.filter((r) => m.regionIds.includes(r.id)).map((r) => r.name);
                const systemNames = content.systems.filter((s) => m.systemIds.includes(s.id)).map((s) => s.name);
                const isOpened = opened.has(m.id);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="pl-card"
                      data-model-id={m.id}
                      ref={(el) => { if (el && restoreFocusId === m.id) el.focus(); }}
                      onClick={() => onOpen(m.id)}
                    >
                      <span className="pl-card__img"><AssetImage path={m.thumbnail} alt="" /></span>
                      <span className="pl-card__body">
                        <span className="pl-card__title">{m.title}</span>
                        <span className="pl-card__tags">
                          {[...regionNames, ...systemNames].slice(0, 4).map((n) => <span key={n} className="chip">{n}</span>)}
                        </span>
                        <span className="pl-card__meta">
                          <span>{m.annotations.length} {m.annotations.length === 1 ? 'annotation' : 'annotations'}</span>
                          {isOpened && <span className="pl-card__done"><Check size={14} aria-hidden="true" /> Opened</span>}
                          {required > 0 && content.completion === 'open-all-and-annotations' && <span>{viewed}/{required} viewed</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
