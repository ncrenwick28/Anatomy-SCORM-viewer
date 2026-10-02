import { create } from 'zustand';
import { newId, nowIso } from '../../shared/ids';
import { defaultExportConfig, type ExportConfig, type ModelRecord, type Project } from '../../shared/types';
import { describeStorageError, defaultProject } from '../../storage/ProjectStore';
import { getDb } from './db';
import { toast } from './toasts';

export type SaveState = 'saved' | 'saving' | 'dirty' | 'error' | 'conflict';

interface StudioState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  project: Project;
  models: ModelRecord[];
  save: { state: SaveState; lastSavedAt: number | null; error: string | null };
  persistent: boolean | null;
  /** Another tab saved changes since this tab loaded the project. */
  staleElsewhere: boolean;
  /** A long-running operation (e.g. an import) that should block "leave page" without a warning. */
  busy: number;

  init: () => Promise<void>;
  reload: () => Promise<void>;
  addModel: (m: ModelRecord) => void;
  updateModel: (id: string, fn: (m: ModelRecord) => ModelRecord) => void;
  removeModel: (id: string) => Promise<void>;
  duplicateModel: (id: string) => Promise<string | null>;
  updateProject: (fn: (p: Project) => Project) => void;
  updateExportConfig: (patch: Partial<ExportConfig>) => void;
  toggleSelected: (id: string) => void;
  flush: () => Promise<void>;
  resolveConflict: (how: 'reload' | 'overwrite') => Promise<void>;
  beginBusy: () => () => void;
}

const dirtyModels = new Set<string>();
let projectDirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;
/** Revision of each record as this tab last read or wrote it. */
const knownRev = new Map<string, string | undefined>();
let knownProjectRev: string | undefined;
let channel: BroadcastChannel | null = null;

export const useStudio = create<StudioState>((set, get) => {
  const schedule = () => {
    set((s) => (s.save.state === 'conflict' ? s : { save: { ...s.save, state: 'dirty', error: null } }));
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void get().flush(), 450);
  };

  const rememberRevs = (models: ModelRecord[], project: Project) => {
    knownRev.clear();
    for (const m of models) knownRev.set(m.id, m.rev);
    knownProjectRev = project.rev;
  };

  return {
    status: 'loading',
    error: null,
    project: defaultProject(),
    models: [],
    save: { state: 'saved', lastSavedAt: null, error: null },
    persistent: null,
    staleElsewhere: false,
    busy: 0,

    async init() {
      try {
        const db = await getDb();
        const [project, models] = await Promise.all([db.getProject(), db.listModels()]);
        // Drop selections whose model no longer exists.
        const ids = new Set(models.map((m) => m.id));
        const selected = project.exportConfig.selectedModelIds.filter((id) => ids.has(id));
        rememberRevs(models, project);
        if (selected.length !== project.exportConfig.selectedModelIds.length) {
          project.exportConfig = { ...project.exportConfig, selectedModelIds: selected };
          projectDirty = true;
        }
        set({ status: 'ready', project, models, error: null });
        if (projectDirty) schedule();
        navigator.storage?.persisted?.().then((p) => set({ persistent: p }), () => undefined);
        // Tell other tabs when this one saves, and learn when they do.
        if (typeof BroadcastChannel !== 'undefined' && !channel) {
          channel = new BroadcastChannel('anatomy-scorm-studio');
          channel.onmessage = () => set({ staleElsewhere: true });
        }
        void db.sweepOrphanAssets().catch(() => undefined);
      } catch (e) {
        set({ status: 'error', error: describeStorageError(e) });
      }
    },

    async reload() {
      await get().flush();
      const db = await getDb();
      const [project, models] = await Promise.all([db.getProject(), db.listModels()]);
      rememberRevs(models, project);
      set({ project, models, staleElsewhere: false });
    },

    addModel(m) {
      set((s) => ({ models: [...s.models, m] }));
      dirtyModels.add(m.id);
      schedule();
    },

    updateModel(id, fn) {
      set((s) => ({ models: s.models.map((m) => (m.id === id ? { ...fn(m), updatedAt: nowIso() } : m)) }));
      dirtyModels.add(id);
      schedule();
    },

    async removeModel(id) {
      await get().flush();
      const db = await getDb();
      try {
        await db.deleteModel(id);
        dirtyModels.delete(id);
        knownRev.delete(id);
        channel?.postMessage({ type: 'deleted', at: Date.now() });
        set((s) => ({
          models: s.models.filter((m) => m.id !== id),
          project: { ...s.project, exportConfig: { ...s.project.exportConfig, selectedModelIds: s.project.exportConfig.selectedModelIds.filter((x) => x !== id) } },
        }));
        projectDirty = true;
        schedule();
      } catch (e) {
        set((s) => ({ save: { ...s.save, state: 'error', error: describeStorageError(e) } }));
        throw e;
      }
    },

    async duplicateModel(id) {
      const src = get().models.find((m) => m.id === id);
      if (!src) return null;
      const now = nowIso();
      const copy: ModelRecord = {
        ...structuredClone(src),
        id: newId('model'),
        rev: undefined,
        title: `${src.title} (copy)`.slice(0, 120),
        isDemo: src.isDemo,
        annotations: src.annotations.map((a) => ({ ...structuredClone(a), id: newId('ann') })),
        // The copy shares the (immutable) model files and thumbnail with the original.
        createdAt: now,
        updatedAt: now,
      };
      get().addModel(copy);
      return copy.id;
    },

    updateProject(fn) {
      set((s) => ({ project: fn(s.project) }));
      projectDirty = true;
      schedule();
    },

    updateExportConfig(patch) {
      get().updateProject((p) => ({ ...p, exportConfig: { ...p.exportConfig, ...patch } }));
    },

    toggleSelected(id) {
      const cur = get().project.exportConfig.selectedModelIds;
      get().updateExportConfig({ selectedModelIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
    },

    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (saving) await saving;
      if (get().save.state === 'conflict') return; // never write over another tab's work without an explicit choice
      if (!dirtyModels.size && !projectDirty) {
        set((s) => (s.save.state === 'saved' ? s : { save: { ...s.save, state: 'saved', error: null } }));
        return;
      }
      const ids = [...dirtyModels];
      const wasProjectDirty = projectDirty;
      dirtyModels.clear();
      projectDirty = false;
      set((s) => ({ save: { ...s.save, state: 'saving' } }));
      saving = (async () => {
        try {
          const db = await getDb();
          const { models, project } = get();
          const result = await db.commitChanges({
            models: models.filter((m) => ids.includes(m.id)).map((m) => ({ record: m, baseRev: knownRev.get(m.id) })),
            project: wasProjectDirty ? { record: project, baseRev: knownProjectRev } : undefined,
          });
          if (!result.ok) {
            // Models whose files no longer exist were deleted elsewhere: forget this tab's copy instead of resurrecting a broken record.
            if (result.missingFiles.length) {
              const gone = new Set(result.missingFiles);
              const titles = get().models.filter((m) => gone.has(m.id)).map((m) => `“${m.title}”`);
              set((s) => ({
                models: s.models.filter((m) => !gone.has(m.id)),
                project: { ...s.project, exportConfig: { ...s.project.exportConfig, selectedModelIds: s.project.exportConfig.selectedModelIds.filter((x) => !gone.has(x)) } },
              }));
              gone.forEach((id) => { knownRev.delete(id); dirtyModels.delete(id); });
              toast.error(`${titles.join(', ')} ${titles.length === 1 ? 'was' : 'were'} deleted in another tab, so ${titles.length === 1 ? 'it' : 'they'} no longer exist${titles.length === 1 ? 's' : ''} here either. Nothing was restored.`);
              set((s) => ({ staleElsewhere: true, save: { ...s.save, state: dirtyModels.size || projectDirty || wasProjectDirty ? 'dirty' : 'saved' } }));
            }
            const stillDirty = ids.filter((i) => !result.missingFiles.includes(i));
            if (result.conflicts.length || result.projectConflict) {
              stillDirty.forEach((i) => dirtyModels.add(i));
              if (wasProjectDirty) projectDirty = true;
              set((s) => ({
                staleElsewhere: true,
                save: { ...s.save, state: 'conflict', error: 'Another browser tab or window saved changes to this project after this tab loaded it. To avoid losing that work, this tab has stopped saving.' },
              }));
            } else if (result.missingFiles.length) {
              // Only deleted-elsewhere models were refused: retry the rest straight away.
              stillDirty.forEach((i) => dirtyModels.add(i));
              if (wasProjectDirty) projectDirty = true;
              schedule();
            }
            return;
          }
          for (const [id, rev] of Object.entries(result.revs)) knownRev.set(id, rev);
          if (result.projectRev) knownProjectRev = result.projectRev;
          channel?.postMessage({ type: 'saved', at: Date.now() });
          set((s) => ({
            models: s.models.map((m) => (result.revs[m.id] ? { ...m, rev: result.revs[m.id] } : m)),
            save: { state: dirtyModels.size || projectDirty ? 'dirty' : 'saved', lastSavedAt: Date.now(), error: null },
          }));
          if (dirtyModels.size || projectDirty) schedule();
        } catch (e) {
          ids.forEach((i) => dirtyModels.add(i));
          if (wasProjectDirty) projectDirty = true;
          set((s) => ({ save: { ...s.save, state: 'error', error: describeStorageError(e) } }));
        } finally {
          saving = null;
        }
      })();
      await saving;
    },

    /** Resolve an edit conflict: discard this tab's unsaved changes and load the latest, or overwrite with this tab's copy. */
    async resolveConflict(how) {
      if (saving) await saving;
      const db = await getDb();
      if (how === 'reload') {
        dirtyModels.clear();
        projectDirty = false;
        const [project, models] = await Promise.all([db.getProject(), db.listModels()]);
        rememberRevs(models, project);
        set({ project, models, staleElsewhere: false, save: { state: 'saved', lastSavedAt: Date.now(), error: null } });
        return;
      }
      const revs = await db.getRevisions([...dirtyModels]);
      const deleted: string[] = [];
      for (const [id, rev] of Object.entries(revs.models)) {
        if (rev === null) deleted.push(id); // deleted elsewhere: it is not brought back
        else knownRev.set(id, rev);
      }
      if (deleted.length) {
        const gone = new Set(deleted);
        const titles = get().models.filter((m) => gone.has(m.id)).map((m) => `“${m.title}”`);
        deleted.forEach((id) => { knownRev.delete(id); dirtyModels.delete(id); });
        set((s) => ({
          models: s.models.filter((m) => !gone.has(m.id)),
          project: { ...s.project, exportConfig: { ...s.project.exportConfig, selectedModelIds: s.project.exportConfig.selectedModelIds.filter((x) => !gone.has(x)) } },
        }));
        toast.info(`${titles.join(', ')} ${titles.length === 1 ? 'was' : 'were'} deleted in another tab and ${titles.length === 1 ? 'was' : 'were'} not restored.`);
      }
      knownProjectRev = revs.project;
      set((s) => ({ staleElsewhere: false, save: { ...s.save, state: 'dirty', error: null } }));
      await get().flush();
    },

    beginBusy() {
      set((s) => ({ busy: s.busy + 1 }));
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        set((s) => ({ busy: Math.max(0, s.busy - 1) }));
      };
    },
  };
});

export function hasUnsavedWork(): boolean {
  const st = useStudio.getState();
  return st.save.state === 'dirty' || st.save.state === 'saving' || st.save.state === 'error' || st.save.state === 'conflict' || st.busy > 0;
}

export function selectedModels(state: Pick<StudioState, 'models' | 'project'>): ModelRecord[] {
  const byId = new Map(state.models.map((m) => [m.id, m]));
  return state.project.exportConfig.selectedModelIds.map((id) => byId.get(id)).filter((m): m is ModelRecord => !!m);
}

export { defaultExportConfig };
