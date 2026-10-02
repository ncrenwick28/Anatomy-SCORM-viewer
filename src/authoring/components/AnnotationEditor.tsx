import { useEffect, useId, useState } from 'react';
import { Crosshair, Move, Trash2 } from 'lucide-react';
import { LIMITS, type Annotation } from '../../shared/types';
import { sanitiseUrl } from '../../shared/richtext';
import { RichText } from '../../ui/RichText';
import type { MarkerState } from '../../viewer/types';

interface Props {
  annotation: Annotation;
  index: number;
  categories: string[];
  state?: MarkerState;
  moving: boolean;
  onChange: (patch: Partial<Annotation>, coalesceKey: string) => void;
  onDelete: () => void;
  onToggleMove: () => void;
  onMoveToCentre: () => void;
  onFocusOnModel: () => void;
  labelRef?: React.RefObject<HTMLInputElement | null>;
}

/** Edit form plus a live preview of what students will read. */
export function AnnotationEditor({ annotation: a, index, categories, state, moving, onChange, onDelete, onToggleMove, onMoveToCentre, onFocusOnModel, labelRef }: Props) {
  const uid = useId();
  const [linkUrl, setLinkUrl] = useState(a.link?.url ?? '');
  const [linkTitle, setLinkTitle] = useState(a.link?.title ?? '');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    setLinkUrl(a.link?.url ?? '');
    setLinkTitle(a.link?.title ?? '');
    setTouched(false);
  }, [a.id]);

  const labelErr = !a.label.trim() ? 'Enter a short label. An empty label is replaced by “Annotation n” when you leave the field.' : null;
  const linkErr = linkUrl.trim() && !sanitiseUrl(linkUrl) ? 'Enter a full web address starting with http:// or https:// (it is not saved until valid).' : null;

  const commitLink = (url: string, title: string) => {
    const t = url.trim();
    if (!t) return onChange({ link: null }, `${a.id}:link`);
    const clean = sanitiseUrl(t);
    if (clean) onChange({ link: { url: clean, title: title.trim().slice(0, 120) } }, `${a.id}:link`);
  };

  return (
    <section className="ann-edit" aria-label={`Edit annotation ${index + 1}`} data-testid="annotation-editor">
      <div className="ann-edit__head">
        <span className="ann-num ann-num--lg" aria-hidden="true">{index + 1}</span>
        <h3>Annotation {index + 1}</h3>
        <button type="button" className="btn btn--sm btn--danger-outline" onClick={onDelete} data-testid="annotation-delete"><Trash2 /> Delete</button>
      </div>

      {state === 'occluded' && <div className="callout callout--info ann-edit__note"><span>This marker is on a hidden side of the model.</span><button type="button" className="btn btn--sm" onClick={onFocusOnModel}><Crosshair /> Turn to it</button></div>}
      {state === 'structure-hidden' && <div className="callout callout--warn ann-edit__note"><span>Its structure is currently hidden in the viewer.</span></div>}

      <div className="field">
        <label htmlFor={`${uid}-label`}>Label</label>
        <input id={`${uid}-label`} ref={labelRef} className="input" value={a.label} maxLength={LIMITS.maxAnnotationLabel} onChange={(e) => onChange({ label: e.target.value }, `${a.id}:label`)} onBlur={() => { setTouched(true); const t = a.label.trim(); if (!t) onChange({ label: `Annotation ${index + 1}` }, `${a.id}:label`); else if (t !== a.label) onChange({ label: t }, `${a.id}:label`); }} aria-invalid={touched && !!labelErr} aria-describedby={`${uid}-label-err`} data-testid="annotation-label" />
        <span id={`${uid}-label-err`} className="error-text" role={touched && labelErr ? 'alert' : undefined}>{touched ? labelErr : ''}</span>
        <span className="hint">A short anatomical name, e.g. “Left ventricle”. {a.label.length}/{LIMITS.maxAnnotationLabel}</span>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-desc`}>Description</label>
        <textarea id={`${uid}-desc`} className="textarea" rows={5} value={a.description} maxLength={LIMITS.maxAnnotationDescription} onChange={(e) => onChange({ description: e.target.value }, `${a.id}:description`)} data-testid="annotation-description" />
        <span className="hint">Blank line = new paragraph; <code>- </code> for bullets; <code>**bold**</code>; <code>*italic*</code>. HTML is shown as typed, never run. {a.description.length}/{LIMITS.maxAnnotationDescription}</span>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-cat`}>Category or tag <span className="hint">(optional)</span></label>
        <input id={`${uid}-cat`} className="input" list={`${uid}-cats`} value={a.category} maxLength={LIMITS.maxCategory} onChange={(e) => onChange({ category: e.target.value }, `${a.id}:category`)} placeholder="e.g. Muscle, Nerve, Landmark" data-testid="annotation-category" />
        <datalist id={`${uid}-cats`}>{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-url`}>Reference link <span className="hint">(optional)</span></label>
        <input id={`${uid}-url`} className="input" type="url" inputMode="url" maxLength={2000} value={linkUrl} placeholder="https://…" aria-invalid={!!linkErr} aria-describedby={`${uid}-url-err`} onChange={(e) => { setLinkUrl(e.target.value); commitLink(e.target.value, linkTitle); }} data-testid="annotation-link" />
        <span id={`${uid}-url-err`} className="error-text" role={linkErr ? 'alert' : undefined}>{linkErr ?? ''}</span>
        <label className="sr-only" htmlFor={`${uid}-ltitle`}>Link text</label>
        <input id={`${uid}-ltitle`} className="input" value={linkTitle} maxLength={120} placeholder="Link text (e.g. “Atlas page”)" disabled={!linkUrl.trim() || !!linkErr} onChange={(e) => { setLinkTitle(e.target.value); commitLink(linkUrl, e.target.value); }} />
        <span className="hint">Opens in a new tab for students. Only http(s) links are allowed.</span>
      </div>
      <label className="check" style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={a.required} onChange={(e) => onChange({ required: e.target.checked }, `${a.id}:required`)} />
        <span><strong>Required for completion</strong><br /><span className="hint">Counts towards the “view all required annotations” completion rule.</span></span>
      </label>

      <div className="ann-edit__position">
        <h4>Position</h4>
        <p className="hint">The marker is attached to “{a.anchor.meshName || 'the model'}” and stays on it when the view changes.</p>
        <div className="btn-row">
          <button type="button" className="btn btn--sm" aria-pressed={moving} onClick={onToggleMove} data-testid="annotation-move"><Move /> {moving ? 'Click the model… (Esc to cancel)' : 'Reposition on the model'}</button>
          <button type="button" className="btn btn--sm" onClick={onMoveToCentre} title="Keyboard-friendly alternative to clicking: moves the marker to the point at the centre of the viewport"><Crosshair /> Move to centre of view</button>
        </div>
      </div>

      <div className="ann-edit__preview" aria-label="How students will see this annotation">
        <h4>Student view</h4>
        <div className="ann-edit__preview-card">
          <strong>{a.label || '(no label)'}</strong>
          {a.category && <span className="chip chip--accent" style={{ marginLeft: 8 }}>{a.category}</span>}
          {a.description.trim() ? <RichText text={a.description} /> : <p className="hint">No description yet.</p>}
          {a.link && sanitiseUrl(a.link.url) && <p><a href={a.link.url} target="_blank" rel="noopener noreferrer">{a.link.title || a.link.url}</a></p>}
        </div>
      </div>
    </section>
  );
}
