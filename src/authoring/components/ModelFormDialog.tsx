import { useEffect, useMemo, useState } from 'react';
import { LIMITS, type ModelRecord } from '../../shared/types';
import { RichText } from '../../ui/RichText';
import { useStudio } from '../state/store';
import { toast } from '../state/toasts';
import { CheckboxGroup } from './CheckboxGroup';
import { Modal, useConfirm } from './Modal';

function fmtBytes(n: number): string {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function ModelInfoList({ model }: { model: ModelRecord }) {
  const s = model.stats;
  const warn = s.totalBytes > LIMITS.modelWarnBytes;
  return (
    <dl className="info-list">
      <dt>File</dt><dd>{model.entryName} ({model.format.toUpperCase()}{model.assets.length > 1 ? `, ${model.assets.length} files` : ''})</dd>
      <dt>Size</dt><dd>{fmtBytes(s.totalBytes)} {warn && <span className="chip chip--warn">Large</span>}</dd>
      <dt>Geometry</dt><dd>{s.triangles.toLocaleString('en-GB')} triangles · {s.vertices.toLocaleString('en-GB')} vertices {s.triangles > LIMITS.trianglesWarn && <span className="chip chip--warn">Heavy</span>}</dd>
      <dt>Structure</dt><dd>{s.meshCount} {s.meshCount === 1 ? 'mesh' : 'meshes'} · {s.materialCount} {s.materialCount === 1 ? 'material' : 'materials'} · {s.textureCount} {s.textureCount === 1 ? 'texture' : 'textures'}</dd>
      <dt>Dimensions</dt><dd>{s.boundsSize.map((v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2))).join(' × ')} (model units)</dd>
      {s.extensionsUsed.length > 0 && (<><dt>Extensions</dt><dd>{s.extensionsUsed.join(', ')}</dd></>)}
    </dl>
  );
}

export function ModelFormDialog({ modelId, open, onOpenChange }: { modelId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const model = useStudio((s) => s.models.find((m) => m.id === modelId) ?? null);
  const project = useStudio((s) => s.project);
  const update = useStudio((s) => s.updateModel);
  const confirm = useConfirm();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [credit, setCredit] = useState('');
  const [regionIds, setRegionIds] = useState<string[]>([]);
  const [systemIds, setSystemIds] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open && model) {
      setTitle(model.title);
      setDescription(model.description);
      setCredit(model.credit);
      setRegionIds(model.regionIds);
      setSystemIds(model.systemIds);
      setTouched(false);
      setShowPreview(false);
    }

  }, [open, modelId]);

  const dirty = useMemo(
    () => !!model && (title !== model.title || description !== model.description || credit !== model.credit || regionIds.join() !== model.regionIds.join() || systemIds.join() !== model.systemIds.join()),
    [model, title, description, credit, regionIds, systemIds],
  );
  const titleError = !title.trim() ? 'Enter a title.' : title.length > LIMITS.maxTitle ? `Keep the title under ${LIMITS.maxTitle} characters.` : null;

  const close = async () => {
    if (dirty && !(await confirm({ title: 'Discard your changes?', message: 'You have edited this model’s details but not saved them.', confirmLabel: 'Discard changes', danger: true }))) return;
    onOpenChange(false);
  };

  const save = () => {
    setTouched(true);
    if (!model || titleError) return;
    update(model.id, (m) => ({ ...m, title: title.trim(), description: description.slice(0, LIMITS.maxDescription), credit: credit.trim(), regionIds, systemIds }));
    toast.ok('Model details saved.');
    onOpenChange(false);
  };

  if (!model) return null;
  return (
    <Modal
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : void close())}
      title="Edit model details"
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={() => void close()}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={save} data-testid="model-save">Save details</button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="field">
          <label htmlFor="mf-title">Title</label>
          <input id="mf-title" className="input" value={title} maxLength={LIMITS.maxTitle + 20} onChange={(e) => setTitle(e.target.value)} aria-invalid={touched && !!titleError} aria-describedby="mf-title-err" autoFocus />
          <span id="mf-title-err" className="error-text" role={touched && titleError ? 'alert' : undefined}>{touched ? titleError : ''}</span>
        </div>
        <div className="field">
          <label htmlFor="mf-desc">Description</label>
          <textarea id="mf-desc" className="textarea" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={LIMITS.maxDescription} />
          <div className="field-row">
            <span className="hint">Plain text. Blank line = new paragraph; <code>- </code> starts a bullet; <code>**bold**</code>, <code>*italic*</code>, <code>[text](https://…)</code>. HTML is shown as typed, never run. {description.length}/{LIMITS.maxDescription}</span>
            <button type="button" className="btn btn--sm btn--ghost" aria-pressed={showPreview} onClick={() => setShowPreview((v) => !v)}>{showPreview ? 'Hide preview' : 'Preview'}</button>
          </div>
          {showPreview && <div className="rich-preview" aria-label="Description preview">{description.trim() ? <RichText text={description} /> : <span className="hint">Nothing to preview yet.</span>}</div>}
        </div>
        <CheckboxGroup legend="Body regions" hint="Choose every region this model belongs to." options={project.regions} value={regionIds} onChange={setRegionIds} idPrefix="mf-region" />
        <CheckboxGroup legend="Body systems" hint="A model can belong to several systems." options={project.systems} value={systemIds} onChange={setSystemIds} idPrefix="mf-system" />
        <div className="field">
          <label htmlFor="mf-credit">Credit and licence <span className="hint">(optional)</span></label>
          <input id="mf-credit" className="input" value={credit} maxLength={LIMITS.maxCredit} onChange={(e) => setCredit(e.target.value)} placeholder="e.g. “Heart model by A. Author, CC BY 4.0”" />
          <span className="hint">Shown to students in the model’s About panel. Check the licence of every model you redistribute.</span>
        </div>
        <details className="info-details">
          <summary>File information</summary>
          <ModelInfoList model={model} />
        </details>
      </form>
    </Modal>
  );
}
