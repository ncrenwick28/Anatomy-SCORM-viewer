import { newId, nowIso } from '../shared/ids';
import { demoEntryToRecord, demoModelId, type DemoProject } from '../shared/demo';
import { defaultViewSettings, DEFAULT_REGIONS, DEFAULT_SYSTEMS, LIMITS, type ModelRecord, type ModelStats } from '../shared/types';
import type { CameraView } from '../shared/types';
import { prepareAssets, type ImportCandidate, type PreparedModelFiles } from '../storage/importer';
import { ViewerCore } from '../viewer/ViewerCore';
import type { LoadProgress, LoadedModelInfo, ModelSource } from '../viewer/types';
import { forgetAssetUrl, openModelSource } from './state/assets';
import { getDb } from './state/db';
import { useStudio } from './state/store';

/** A hidden, off-screen viewer used for analysing models and rendering thumbnails. */
export async function withOffscreenViewer<T>(fn: (v: ViewerCore) => Promise<T>, size = { width: 640, height: 480 }): Promise<T> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${size.width}px;height:${size.height}px;pointer-events:none;`;
  document.body.appendChild(host);
  const viewer = new ViewerCore(host, { offscreen: true, dracoPath: `${import.meta.env.BASE_URL}lib/draco/` });
  viewer.resize(size.width, size.height);
  try {
    return await fn(viewer);
  } finally {
    viewer.dispose();
    host.remove();
  }
}

export interface ProbeResult {
  info: LoadedModelInfo;
  initialView: CameraView;
  thumbnail: Blob;
}

export async function probeSource(source: ModelSource, onProgress?: (p: LoadProgress) => void): Promise<ProbeResult> {
  return withOffscreenViewer(async (v) => {
    const info = await v.loadModel(source, { onProgress });
    const initialView = v.getEffectiveDefaultView()!;
    const thumbnail = await v.captureThumbnail({ view: initialView });
    return { info, initialView, thumbnail };
  });
}

async function putThumb(blob: Blob): Promise<string> {
  const db = await getDb();
  const id = newId('asset');
  await db.putAsset({ id, name: 'thumbnail.jpg', mime: 'image/jpeg', size: blob.size, blob, createdAt: nowIso() });
  return id;
}

export interface ImportProgress {
  index: number;
  total: number;
  title: string;
  stage: string;
  fraction: number | null;
}

export interface ImportOutcome {
  imported: ModelRecord[];
  failed: { title: string; message: string }[];
}

function sourceFromPrepared(p: PreparedModelFiles): { source: ModelSource; dispose: () => void } {
  const urls: Record<string, string> = {};
  const made: string[] = [];
  for (const a of p.assets) {
    const u = URL.createObjectURL(a.blob);
    made.push(u);
    urls[a.ref.name] = u;
  }
  return { source: { entryName: p.entryName, format: p.format, urls }, dispose: () => made.forEach((u) => URL.revokeObjectURL(u)) };
}

export async function importCandidates(
  candidates: { candidate: ImportCandidate; title: string }[],
  opts: { regionIds: string[]; systemIds: string[]; onProgress?: (p: ImportProgress) => void },
): Promise<ImportOutcome> {
  const db = await getDb();
  const out: ImportOutcome = { imported: [], failed: [] };
  for (let i = 0; i < candidates.length; i++) {
    const { candidate, title } = candidates[i];
    const report = (stage: string, fraction: number | null = null) => opts.onProgress?.({ index: i, total: candidates.length, title, stage, fraction });
    const storedIds: string[] = [];
    try {
      if (useStudio.getState().models.length >= LIMITS.maxModels) throw new Error(`The library is full (${LIMITS.maxModels} models). Delete some models first.`);
      report('Checking files');
      const prepared = await prepareAssets(candidate);
      report('Analysing model');
      const { source, dispose } = sourceFromPrepared(prepared);
      let probe: ProbeResult;
      try {
        probe = await probeSource(source, (p) => report(p.stage === 'preparing' ? 'Preparing for annotation' : 'Reading model', p.fraction));
      } finally {
        dispose();
      }
      report('Saving');
      for (const a of prepared.assets) {
        await db.putAsset({ id: a.ref.id, name: a.ref.name, mime: a.ref.mime, size: a.ref.size, blob: a.blob, createdAt: nowIso() });
        storedIds.push(a.ref.id);
      }
      const thumbId = await putThumb(probe.thumbnail);
      storedIds.push(thumbId);
      const stats: ModelStats = { ...probe.info.stats, totalBytes: prepared.totalBytes };
      const view = defaultViewSettings();
      const now = nowIso();
      const record: ModelRecord = {
        id: newId('model'),
        title: title.trim().slice(0, 120) || 'Untitled model',
        description: '',
        credit: '',
        isDemo: false,
        regionIds: opts.regionIds,
        systemIds: opts.systemIds,
        format: prepared.format,
        entryName: prepared.entryName,
        assets: prepared.assets.map((a) => a.ref),
        thumbnailAssetId: thumbId,
        stats,
        view,
        annotations: [],
        meshLabels: {},
        createdAt: now,
        updatedAt: now,
      };
      useStudio.getState().addModel(record);
      out.imported.push(record);
    } catch (e) {
      await db.deleteAssets(storedIds).catch(() => undefined);
      const msg = e instanceof Error ? e.message : String(e);
      out.failed.push({ title, message: /Draco|WebGL/i.test(msg) ? msg : `The model could not be displayed after import checks: ${msg}` });
    }
  }
  await useStudio.getState().flush();
  navigator.storage?.persist?.().then((p) => useStudio.setState({ persistent: p }), () => undefined);
  return out;
}

/** Loads the bundled demonstration models (once). Returns how many were added. */
export async function loadDemoContent(onProgress?: (p: ImportProgress) => void): Promise<number> {
  const base = import.meta.env.BASE_URL;
  const demo = (await (await fetch(`${base}demo/demo-project.json`)).json()) as DemoProject;
  const db = await getDb();
  const existing = new Set(useStudio.getState().models.map((m) => m.id));
  const todo = demo.models.filter((m) => !existing.has(demoModelId(m.slug)));
  let added = 0;
  for (let i = 0; i < todo.length; i++) {
    const e = todo[i];
    const report = (stage: string, fraction: number | null = null) => onProgress?.({ index: i, total: todo.length, title: e.title, stage, fraction });
    report('Downloading');
    const res = await fetch(`${base}demo/${e.file}`);
    if (!res.ok) throw new Error(`Could not fetch the demonstration model ${e.file} (HTTP ${res.status}).`);
    const blob = new Blob([await res.arrayBuffer()], { type: 'model/gltf-binary' });
    const glbId = newId('asset');
    const url = URL.createObjectURL(blob);
    let thumb: Blob;
    try {
      report('Rendering thumbnail');
      thumb = await withOffscreenViewer(async (v) => {
        await v.loadModel({ entryName: e.file, format: 'glb', urls: { [e.file]: url } });
        return v.captureThumbnail({ view: e.camera });
      });
    } finally {
      URL.revokeObjectURL(url);
    }
    await db.putAsset({ id: glbId, name: e.file, mime: 'model/gltf-binary', size: blob.size, blob, createdAt: nowIso() });
    const thumbId = await putThumb(thumb);
    useStudio.getState().addModel(demoEntryToRecord(e, glbId, blob.size, thumbId));
    added++;
  }
  // Make sure the categories the demo uses exist (the lecturer may have deleted a default).
  useStudio.getState().updateProject((p) => {
    const needR = new Set(demo.models.flatMap((m) => m.regionIds));
    const needS = new Set(demo.models.flatMap((m) => m.systemIds));
    return {
      ...p,
      regions: [...p.regions, ...DEFAULT_REGIONS.filter((r) => needR.has(r.id) && !p.regions.some((x) => x.id === r.id))],
      systems: [...p.systems, ...DEFAULT_SYSTEMS.filter((s) => needS.has(s.id) && !p.systems.some((x) => x.id === s.id))],
    };
  });
  await useStudio.getState().flush();
  return added;
}

/** Re-renders a model's thumbnail from its saved default view and stores it, replacing the old one. */
export async function regenerateThumbnail(modelId: string, viewer?: ViewerCore | null): Promise<void> {
  const model = useStudio.getState().models.find((m) => m.id === modelId);
  if (!model) throw new Error('Model not found.');
  const db = await getDb();
  let blob: Blob;
  if (viewer?.hasModel()) {
    blob = await viewer.captureThumbnail({ view: model.view.camera });
  } else {
    const { source, dispose } = await openModelSource(model);
    try {
      blob = await withOffscreenViewer(async (v) => {
        await v.loadModel(source, {});
        v.setBackground(model.view.background);
        v.setLighting(model.view.lighting);
        v.setHiddenKeys(model.view.hiddenMeshKeys);
        return v.captureThumbnail({ view: model.view.camera });
      });
    } finally {
      dispose();
    }
  }
  const newThumb = await putThumb(blob);
  const old = model.thumbnailAssetId;
  useStudio.getState().updateModel(modelId, (m) => ({ ...m, thumbnailAssetId: newThumb }));
  const stillUsed = useStudio.getState().models.some((m) => m.id !== modelId && m.thumbnailAssetId === old);
  if (old && !stillUsed) {
    await db.deleteAssets([old]).catch(() => undefined);
    forgetAssetUrl(old);
  }
}

/** Loads each model off-screen and verifies its annotations still sit on their structures. */
export async function deepCheckAnchors(models: ModelRecord[], onProgress?: (i: number, n: number, title: string) => void) {
  const result: Record<string, { annotationId: string; label: string; reason: string }[]> = {};
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    onProgress?.(i, models.length, m.title);
    if (!m.annotations.length) continue;
    try {
      const { source, dispose } = await openModelSource(m);
      try {
        const problems = await withOffscreenViewer(async (v) => {
          await v.loadModel(source, {});
          v.setAnnotations(m.annotations);
          return v.verifyAnchors().filter((r) => !r.ok);
        });
        if (problems.length) result[m.id] = problems.map((p) => ({ annotationId: p.id, label: p.label, reason: p.reason ?? 'its position could not be verified.' }));
      } finally {
        dispose();
      }
    } catch (e) {
      result[m.id] = [{ annotationId: '', label: '(model)', reason: `the model could not be loaded for checking: ${(e as Error).message}` }];
    }
  }
  onProgress?.(models.length, models.length, '');
  return result;
}
