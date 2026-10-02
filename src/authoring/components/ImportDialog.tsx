import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, CheckCircle2, FileBox, FolderOpen, Upload, XCircle } from 'lucide-react';
import { planImports, type ImportCandidate, type ImportInput, type ImportPlan } from '../../storage/importer';
import { importCandidates, type ImportProgress } from '../pipeline';
import { useStudio } from '../state/store';
import { toast } from '../state/toasts';
import { CheckboxGroup } from './CheckboxGroup';
import { Modal } from './Modal';

const fmt = (n: number) => (n < 1024 ? `${n} byte${n === 1 ? '' : 's'}` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Reads dropped files and folders (folders recursively, keeping relative paths for texture matching). */
async function collectDropped(dt: DataTransfer): Promise<ImportInput[]> {
  const out: ImportInput[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      }
    }
  };
  const items = Array.from(dt.items ?? []);
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (entries.length) for (const e of entries) await walk(e, '');
  else for (const f of Array.from(dt.files)) out.push({ file: f });
  return out;
}

export function ImportDialog({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (o: boolean) => void; onImported?: (ids: string[]) => void }) {
  const project = useStudio((s) => s.project);
  const [inputs, setInputs] = useState<ImportInput[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [regionIds, setRegionIds] = useState<string[]>([]);
  const [systemIds, setSystemIds] = useState<string[]>([]);
  const [planning, setPlanning] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [failed, setFailed] = useState<{ title: string; message: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const busy = !!progress;

  useEffect(() => {
    if (open) {
      setInputs([]);
      setPlan(null);
      setTitles({});
      setRegionIds([]);
      setSystemIds([]);
      setProgress(null);
      setFailed([]);
    }
  }, [open]);

  const addFiles = useCallback(async (added: ImportInput[]) => {
    if (!added.length) return;
    setPlanning(true);
    setFailed([]);
    try {
      const merged = [...inputs.filter((x) => !added.some((a) => a.file.name === x.file.name && a.file.size === x.file.size)), ...added];
      const p = await planImports(merged);
      setInputs(merged);
      setPlan(p);
      setTitles((t) => {
        const next = { ...t };
        for (const c of p.candidates) {
          const key = c.entry.file.name;
          if (!(key in next)) next[key] = c.title;
        }
        return next;
      });
    } finally {
      setPlanning(false);
    }
  }, [inputs]);

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    await addFiles(await collectDropped(e.dataTransfer));
  };
  const fromList = (list: FileList | null): ImportInput[] => Array.from(list ?? []).map((file) => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined }));

  const valid = plan?.candidates.filter((c) => !c.errors.length) ?? [];
  const invalid = plan?.candidates.filter((c) => c.errors.length) ?? [];
  const missingAll = [...new Set(invalid.flatMap((c) => c.missing))];

  const run = async () => {
    setFailed([]);
    const out = await importCandidates(
      valid.map((c) => ({ candidate: c, title: titles[c.entry.file.name] ?? c.title })),
      { regionIds, systemIds, onProgress: setProgress },
    );
    setProgress(null);
    if (out.imported.length) {
      toast.ok(`Imported ${out.imported.length} model${out.imported.length === 1 ? '' : 's'}.`);
      onImported?.(out.imported.map((m) => m.id));
    }
    for (const w of out.warnings) toast.info(w);
    if (out.failed.length) {
      // Nothing left that can be imported from this selection; make the user choose again.
      setFailed(out.failed);
      setInputs([]);
      setPlan(null);
    } else onOpenChange(false);
  };

  const Row = ({ c }: { c: ImportCandidate }) => {
    const ok = !c.errors.length;
    return (
      <li className={`imp-row ${ok ? '' : 'is-bad'}`}>
        <div className="imp-row__icon">{ok ? <CheckCircle2 className="ok" aria-hidden="true" /> : <XCircle className="bad" aria-hidden="true" />}</div>
        <div className="imp-row__main">
          <div className="imp-row__file"><FileBox size={15} aria-hidden="true" /> <strong>{c.entry.file.name}</strong> <span className="hint">{c.kind.toUpperCase()} · {fmt(c.totalBytes)}{c.companions.length ? ` · ${c.companions.length} companion file${c.companions.length === 1 ? '' : 's'}` : ''}{c.summary ? ` · ${c.summary.meshCount} mesh${c.summary.meshCount === 1 ? '' : 'es'}` : ''}</span></div>
          {ok && (
            <div className="field" style={{ margin: '8px 0 0' }}>
              <label className="sr-only" htmlFor={`imp-title-${c.id}`}>Title for {c.entry.file.name}</label>
              <input id={`imp-title-${c.id}`} className="input" value={titles[c.entry.file.name] ?? c.title} onChange={(e) => setTitles((t) => ({ ...t, [c.entry.file.name]: e.target.value }))} maxLength={120} disabled={busy} />
            </div>
          )}
          {c.errors.map((e) => <p key={e} className="error-text" role="alert">{e}</p>)}
          {c.warnings.map((w) => <p key={w} className="warn-text"><AlertTriangle size={14} aria-hidden="true" /> {w}</p>)}
        </div>
      </li>
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      locked={busy}
      title="Import 3D models"
      description={<>Supported: <strong>GLB</strong> and <strong>glTF 2.0</strong> (with its <code>.bin</code> and texture files). Other formats must be converted first, for example with Blender (File → Export → glTF 2.0).</>}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)} disabled={busy}>{failed.length ? 'Close' : 'Cancel'}</button>
          <button type="button" className="btn btn--primary" onClick={() => void run()} disabled={!valid.length || busy || planning} data-testid="import-confirm">
            <Upload /> Import {valid.length || ''} model{valid.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      {!busy && (
        <div
          className={`dropzone ${dragging ? 'is-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => void onDrop(e)}
        >
          <Upload size={28} aria-hidden="true" />
          <p><strong>Drop model files or a folder here</strong></p>
          <div className="dropzone__buttons">
            <button type="button" className="btn" onClick={() => fileInput.current?.click()} data-testid="import-choose">Choose files…</button>
            <button type="button" className="btn" onClick={() => folderInput.current?.click()}><FolderOpen /> Choose a folder…</button>
          </div>
          <input ref={fileInput} type="file" multiple accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp" hidden data-testid="import-input" onChange={(e) => { void addFiles(fromList(e.target.files)); e.target.value = ''; }} />
          <input ref={folderInput} type="file" multiple hidden {...({ webkitdirectory: '' } as object)} onChange={(e) => { void addFiles(fromList(e.target.files)); e.target.value = ''; }} />
          <p className="hint">A .gltf model needs its .bin and image files alongside it. Select them all together, or add the missing ones afterwards.</p>
        </div>
      )}
      {planning && <p role="status"><span className="spinner" /> Checking files…</p>}

      {plan && !busy && (
        <>
          {plan.candidates.length > 0 && <ul className="imp-list" aria-label="Files to import">{plan.candidates.map((c) => <Row key={c.id} c={c} />)}</ul>}
          {missingAll.length > 0 && (
            <div className="callout callout--warn" role="status">
              <div>
                <strong>Missing companion files:</strong> {missingAll.join(', ')}.<br />
                <button type="button" className="btn btn--sm" style={{ marginTop: 8 }} onClick={() => fileInput.current?.click()}>Add the missing files…</button>
              </div>
            </div>
          )}
          {plan.ignored.length > 0 && (
            <details className="info-details">
              <summary>{plan.ignored.length} file{plan.ignored.length === 1 ? '' : 's'} not imported</summary>
              <ul className="ignored-list">{plan.ignored.map((i, k) => <li key={k}><strong>{i.name}</strong> — {i.reason}</li>)}</ul>
            </details>
          )}
          {valid.length > 0 && (
            <div className="imp-cats">
              <CheckboxGroup legend="Body regions" hint="Applies to all models in this import. You can change it later." options={project.regions} value={regionIds} onChange={setRegionIds} idPrefix="imp-region" />
              <CheckboxGroup legend="Body systems" options={project.systems} value={systemIds} onChange={setSystemIds} idPrefix="imp-system" />
            </div>
          )}
        </>
      )}

      {progress && (
        <div className="imp-progress" role="status" aria-live="polite" data-testid="import-progress">
          <p><strong>Importing {progress.index + 1} of {progress.total}: {progress.title}</strong></p>
          <p className="hint">{progress.stage}…</p>
          <div className="progress"><i style={{ width: `${Math.round(((progress.index + (progress.fraction ?? 0.4)) / progress.total) * 100)}%` }} /></div>
        </div>
      )}
      {failed.length > 0 && (
        <div className="callout callout--error" role="alert">
          <div>
            <strong>{failed.length} model{failed.length === 1 ? '' : 's'} could not be imported:</strong>
            <ul>{failed.map((f) => <li key={f.title}><strong>{f.title}</strong>: {f.message}</li>)}</ul>
          </div>
        </div>
      )}
    </Modal>
  );
}
