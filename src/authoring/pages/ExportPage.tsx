import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Download, Info, PlayCircle, ShieldCheck, Trash2, Upload, XCircle } from 'lucide-react';
import { buildPreviewContent } from '../../export/previewContent';
import type { PreflightIssue } from '../../export/preflight';
import { Player } from '../../player/Player';
import { ProgressTracker } from '../../player/tracker';
import { accentTheme, contrastRatio, isValidHex, normaliseHex } from '../../shared/color';
import { COMPLETION_RULE_LABELS } from '../../shared/completion';
import { newId, nowIso } from '../../shared/ids';
import { LIMITS, type CompletionRule, type PlayerFeatures } from '../../shared/types';
import { RichText } from '../../ui/RichText';
import { AssetThumb } from '../components/AssetThumb';
import { download } from '../components/BackupMenu';
import { ExportBlockedError, quickPreflight, runExport, type BuildProgress, type BuildResult } from '../exportRunner';
import { deepCheckAnchors } from '../pipeline';
import { assetUrl, forgetAssetUrl } from '../state/assets';
import { getDb } from '../state/db';
import { selectedModels, useStudio } from '../state/store';
import { toast } from '../state/toasts';

const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const FEATURES: { key: keyof PlayerFeatures; label: string; hint: string }[] = [
  { key: 'search', label: 'Search', hint: 'Students can search models by title, description and annotation names.' },
  { key: 'browseByCategory', label: 'Browse by body region and system', hint: 'Filter chips in the gallery.' },
  { key: 'annotationList', label: 'Searchable annotation list', hint: 'A list beside the model as an alternative to clicking markers.' },
  { key: 'selfStudy', label: 'Self-study mode', hint: 'Students can hide annotation names and reveal them when ready. Needs the annotation list.' },
  { key: 'structureList', label: 'Structure list', hint: 'Show/hide and isolate separate meshes (only for models with several meshes).' },
  { key: 'fullscreen', label: 'Full-screen button', hint: 'Falls back to filling the frame when the LMS does not allow full screen.' },
];

function IssueIcon({ level }: { level: PreflightIssue['level'] }) {
  if (level === 'error') return <XCircle className="bad" aria-hidden="true" />;
  if (level === 'warning') return <AlertTriangle className="warn" aria-hidden="true" />;
  return <Info className="info" aria-hidden="true" />;
}

export function ExportPage({ onGoLibrary }: { onGoLibrary: () => void }) {
  const state = useStudio();
  const { project } = state;
  const config = project.exportConfig;
  const selected = useMemo(() => selectedModels(state), [state.models, state.project]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = state.updateExportConfig;
  const [report, setReport] = useState<Awaited<ReturnType<typeof quickPreflight>> | null>(null);
  const [anchorProblems, setAnchorProblems] = useState<Record<string, { annotationId: string; label: string; reason: string }[]> | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [building, setBuilding] = useState<BuildProgress | null>(null);
  const [result, setResult] = useState<(BuildResult & { url: string }) | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [accentText, setAccentText] = useState(config.accent);

  useEffect(() => setAccentText(config.accent), [config.accent]);
  useEffect(() => {
    let alive = true;
    assetUrl(config.logoAssetId).then((u) => alive && setLogoUrl(u));
    return () => { alive = false; };
  }, [config.logoAssetId]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  // Live (cheap) checks whenever the configuration or models change.
  useEffect(() => {
    let alive = true;
    quickPreflight().then((r) => alive && setReport(r));
    setAnchorProblems(null);
    return () => { alive = false; };
  }, [state.project, state.models]);

  const theme = accentTheme(config.accent);
  const accentRatio = isValidHex(config.accent) ? contrastRatio(config.accent, theme.contrast) : 0;

  const move = (id: string, d: number) => {
    const ids = [...config.selectedModelIds];
    const i = ids.indexOf(id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    set({ selectedModelIds: ids });
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) return toast.error('Choose a PNG, JPEG, WebP, GIF or SVG image for the logo.');
    if (file.size > LIMITS.maxLogoBytes) return toast.error(`That logo is ${fmtBytes(file.size)}. Please use an image under ${fmtBytes(LIMITS.maxLogoBytes)}.`);
    const db = await getDb();
    const id = newId('asset');
    const name = file.name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'logo';
    await db.putAsset({ id, name, mime: file.type, size: file.size, blob: file, createdAt: nowIso() });
    const old = config.logoAssetId;
    set({ logoAssetId: id });
    if (old) { await db.deleteAssets([old]); forgetAssetUrl(old); }
  };
  const removeLogo = async () => {
    const old = config.logoAssetId;
    set({ logoAssetId: null });
    if (old) { (await getDb()).deleteAssets([old]); forgetAssetUrl(old); }
  };

  const fullCheck = async () => {
    setChecking('Starting…');
    try {
      const problems = await deepCheckAnchors(selected, (i, n, t) => setChecking(t ? `Checking ${t} (${i + 1} of ${n})` : 'Finishing…'));
      setAnchorProblems(problems);
      toast[Object.keys(problems).length ? 'error' : 'ok'](Object.keys(problems).length ? 'Some annotations need attention — see the checks below.' : 'Every annotation sits on its structure.');
    } finally {
      setChecking(null);
    }
  };

  const build = async () => {
    setBuildError(null);
    setResult(null);
    setBuilding({ label: 'Starting…', fraction: 0 });
    try {
      const r = await runExport(setBuilding);
      const url = URL.createObjectURL(r.built.blob);
      setResult({ ...r, url });
      download(r.built.blob, r.filename);
      toast.ok(`Package built: ${fmtBytes(r.built.bytes)}.`);
    } catch (e) {
      if (e instanceof ExportBlockedError) {
        setBuildError('The package was not built because the checks below found problems.');
        setReport((prev) => (prev ? { ...prev, ...e.report } : prev));
      } else {
        setBuildError(`The package could not be built: ${(e as Error).message}`);
      }
    } finally {
      setBuilding(null);
    }
  };

  const issues: PreflightIssue[] = useMemo(() => {
    const base = report?.issues ?? [];
    const extra: PreflightIssue[] = [];
    for (const m of selected) for (const p of anchorProblems?.[m.id] ?? []) extra.push({ level: 'error', code: 'anchor-problem', modelId: m.id, message: `“${m.title}”, “${p.label}”: ${p.reason}`, fix: 'Open the model and reposition or delete this annotation.' });
    return [...extra, ...base].sort((a, b) => ({ error: 0, warning: 1, info: 2 }[a.level] - { error: 0, warning: 1, info: 2 }[b.level]));
  }, [report, anchorProblems, selected]);
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warning').length;

  const previewContent = useMemo(() => buildPreviewContent(config, project.regions, project.systems, selected), [config, project.regions, project.systems, selected]);
  const previewTracker = useMemo(() => new ProgressTracker(previewContent, { api: null, storage: null }), [previewContent]);
  useEffect(() => { if (previewing) previewTracker.start(); }, [previewing, previewTracker]);

  if (previewing) {
    return <Player content={previewContent} tracker={previewTracker} resolveAsset={async (p) => (p.startsWith('asset:') ? (await assetUrl(p.slice(6))) ?? '' : p)} dracoPath={`${import.meta.env.BASE_URL}lib/draco/`} preview={{ onExit: () => setPreviewing(false), label: 'Package preview' }} />;
  }

  const totalAnn = selected.reduce((s, m) => s + m.annotations.length, 0);
  const totalBytes = selected.reduce((s, m) => s + m.stats.totalBytes, 0);

  return (
    <div className="exp">
      <div className="page-head">
        <div>
          <h1>Export a SCORM package</h1>
          <p className="hint">SCORM 1.2 · works offline from the authoring app · no external services</p>
        </div>
        <div className="page-head__actions">
          <button type="button" className="btn" onClick={onGoLibrary}>Choose models in the library</button>
        </div>
      </div>

      <div className="exp-grid">
        <div className="exp-col">
          <section className="card" aria-labelledby="exp-models">
            <h2 id="exp-models">1. Models to include <span className="chip">{selected.length}</span></h2>
            {!selected.length ? (
              <div className="empty-inline" data-testid="export-empty"><p>No models selected yet. Tick “Include in export” on the models you want in the library.</p><button type="button" className="btn btn--sm btn--primary" onClick={onGoLibrary}>Go to the library</button></div>
            ) : (
              <>
                <ol className="exp-models" data-testid="export-models">
                  {selected.map((m, i) => (
                    <li key={m.id} data-model-id={m.id}>
                      <AssetThumb id={m.thumbnailAssetId} className="exp-models__thumb" />
                      <div className="exp-models__text">
                        <strong>{m.title}</strong>
                        <span className="hint">{m.annotations.length} annotation{m.annotations.length === 1 ? '' : 's'} · {fmtBytes(m.stats.totalBytes)}</span>
                      </div>
                      <div className="exp-models__btns">
                        <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => move(m.id, -1)} disabled={i === 0} aria-label={`Move ${m.title} earlier`}><ArrowUp /></button>
                        <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => move(m.id, 1)} disabled={i === selected.length - 1} aria-label={`Move ${m.title} later`}><ArrowDown /></button>
                        <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => state.toggleSelected(m.id)} aria-label={`Remove ${m.title} from the export`}><Trash2 /></button>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="hint">{selected.length} models · {totalAnn} annotations · about {fmtBytes(totalBytes)} of model files. Only these models and the files they need go into the package.</p>
              </>
            )}
          </section>

          <section className="card" aria-labelledby="exp-details">
            <h2 id="exp-details">2. Package details</h2>
            <div className="field">
              <label htmlFor="exp-title">Title</label>
              <input id="exp-title" className="input" value={config.title} maxLength={LIMITS.maxTitle} onChange={(e) => set({ title: e.target.value })} data-testid="export-title" />
            </div>
            <div className="field">
              <label htmlFor="exp-desc">Short description <span className="hint">(optional)</span></label>
              <textarea id="exp-desc" className="textarea" rows={2} value={config.description} maxLength={1000} onChange={(e) => set({ description: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="exp-intro">Introductory text <span className="hint">(optional, shown on the gallery page)</span></label>
              <textarea id="exp-intro" className="textarea" rows={4} value={config.intro} maxLength={LIMITS.maxDescription} onChange={(e) => set({ intro: e.target.value })} data-testid="export-intro" />
              {config.intro.trim() && <div className="rich-preview" aria-label="Introduction preview"><RichText text={config.intro} /></div>}
            </div>
            <div className="exp-branding">
              <div className="field">
                <span className="label" id="logo-label">Logo <span className="hint">(optional, PNG/JPEG/WebP/SVG, under 1 MB)</span></span>
                <div className="logo-row">
                  {logoUrl ? <img src={logoUrl} alt="Current logo" className="logo-preview" /> : <div className="logo-preview logo-preview--empty">No logo</div>}
                  <label className="btn btn--sm"><Upload /> {config.logoAssetId ? 'Replace…' : 'Upload…'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden aria-labelledby="logo-label" onChange={(e) => { void uploadLogo(e.target.files?.[0]); e.target.value = ''; }} data-testid="export-logo" /></label>
                  {config.logoAssetId && <button type="button" className="btn btn--sm btn--ghost" onClick={() => void removeLogo()}>Remove</button>}
                </div>
              </div>
              <div className="field">
                <label htmlFor="exp-accent">Accent colour</label>
                <div className="accent-row">
                  <input type="color" aria-label="Pick accent colour" value={isValidHex(config.accent) ? normaliseHex(config.accent) : '#0b6e8a'} onChange={(e) => set({ accent: e.target.value })} className="color-input" />
                  <input id="exp-accent" className="input accent-text" value={accentText} maxLength={7} aria-invalid={!isValidHex(accentText)} onChange={(e) => { setAccentText(e.target.value); if (isValidHex(e.target.value)) set({ accent: normaliseHex(e.target.value) }); }} data-testid="export-accent" />
                  <span className="accent-sample" style={{ background: theme.accent, color: theme.contrast }}>Sample</span>
                </div>
                {!isValidHex(accentText) ? <span className="error-text" role="alert">Enter a colour such as #0b6e8a.</span> : <span className="hint">Text on the accent is set to {theme.contrast === '#ffffff' ? 'white' : 'dark'} ({accentRatio.toFixed(1)}:1 contrast{accentRatio < 4.5 ? ' — below the 4.5:1 guideline; pick a stronger colour' : ''}).</span>}
              </div>
            </div>
          </section>

          <section className="card" aria-labelledby="exp-features">
            <h2 id="exp-features">3. Student features</h2>
            <div className="feature-list">
              {FEATURES.map((f) => (
                <label key={f.key} className="check">
                  <input type="checkbox" checked={config.features[f.key]} disabled={f.key === 'selfStudy' && !config.features.annotationList}
                    onChange={(e) => {
                      const features = { ...config.features, [f.key]: e.target.checked };
                      if (f.key === 'annotationList' && !e.target.checked) features.selfStudy = false;
                      set({ features });
                    }} data-testid={`feature-${f.key}`} />
                  <span><strong>{f.label}</strong><br /><span className="hint">{f.hint}</span></span>
                </label>
              ))}
            </div>
          </section>

          <section className="card" aria-labelledby="exp-completion">
            <h2 id="exp-completion">4. Completion rule</h2>
            <fieldset className="field">
              <legend className="sr-only">Completion rule</legend>
              {(Object.keys(COMPLETION_RULE_LABELS) as CompletionRule[]).map((r) => (
                <label key={r} className={`radio-card ${config.completion === r ? 'is-on' : ''}`}>
                  <input type="radio" name="completion" checked={config.completion === r} onChange={() => set({ completion: r })} data-testid={`completion-${r}`} />
                  <span><strong>{COMPLETION_RULE_LABELS[r].title}</strong><br /><span className="hint">{COMPLETION_RULE_LABELS[r].detail}</span></span>
                </label>
              ))}
            </fieldset>
            <p className="hint">The LMS receives status “incomplete” on first launch and “completed” when the rule is met. No score is reported. Progress is stored as a compact code (a few hundred characters) in <code>cmi.suspend_data</code>, well inside the SCORM 1.2 limit of 4096 characters.</p>
          </section>
        </div>

        <div className="exp-col exp-col--side">
          <section className="card exp-checks" aria-labelledby="exp-checks">
            <h2 id="exp-checks"><ShieldCheck size={20} aria-hidden="true" /> Pre-export checks</h2>
            <p className="check-summary" role="status" aria-live="polite" data-testid="check-summary" data-errors={errors} data-warnings={warnings}>
              {errors ? <span className="chip chip--danger">{errors} problem{errors === 1 ? '' : 's'} to fix</span> : <span className="chip chip--ok"><CheckCircle2 /> No blocking problems</span>}
              {warnings > 0 && <span className="chip chip--warn">{warnings} warning{warnings === 1 ? '' : 's'}</span>}
            </p>
            {issues.length > 0 && (
              <ul className="issue-list" data-testid="issue-list">
                {issues.map((i, k) => (
                  <li key={k} className={`issue issue--${i.level}`}>
                    <IssueIcon level={i.level} />
                    <span>{i.message}{i.fix && <><br /><span className="hint">{i.fix}</span></>}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="btn-row">
              <button type="button" className="btn btn--sm" onClick={() => void fullCheck()} disabled={!!checking || !selected.length} data-testid="full-check">{checking ?? 'Verify annotation positions'}</button>
            </div>
            <p className="hint">Quick checks run as you edit. “Verify” loads each model and confirms every annotation still sits on its structure; it also runs automatically when you build.</p>
          </section>

          <section className="card" aria-labelledby="exp-build">
            <h2 id="exp-build">5. Preview and build</h2>
            <div className="btn-col">
              <button type="button" className="btn" onClick={() => setPreviewing(true)} disabled={!selected.length} data-testid="preview-package"><PlayCircle /> Preview as a student</button>
              <button type="button" className="btn btn--primary btn--lg" onClick={() => void build()} disabled={!!building || !selected.length || errors > 0} data-testid="build-package"><Download /> Build SCORM 1.2 package</button>
            </div>
            {building && (
              <div className="build-progress" role="status" aria-live="polite" data-testid="build-progress">
                <p><span className="spinner" /> {building.label}</p>
                <div className="progress"><i style={{ width: `${Math.round(building.fraction * 100)}%` }} /></div>
              </div>
            )}
            {buildError && <div className="callout callout--error" role="alert" data-testid="build-error"><span>{buildError}</span></div>}
            {result && (
              <div className="callout callout--ok build-result" role="status" data-testid="build-result">
                <div>
                  <strong>Package ready: {result.filename}</strong>
                  <p>{fmtBytes(result.built.bytes)} · {result.built.content.models.length} model{result.built.content.models.length === 1 ? '' : 's'} · {result.built.files.length} files. The download should have started.</p>
                  <a className="btn btn--sm" href={result.url} download={result.filename}><Download /> Download again</a>
                  <details className="info-details">
                    <summary>Package contents</summary>
                    <ul className="file-list">{result.built.files.map((f) => <li key={f.path}><code>{f.path}</code> <span className="hint">{fmtBytes(f.size)}</span></li>)}</ul>
                  </details>
                  <p className="hint">Upload the ZIP to your LMS as a SCORM 1.2 activity. See “Help → LMS notes” for Moodle and Canvas. LMS compatibility has not been verified by this application.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
