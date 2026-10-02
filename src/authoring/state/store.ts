import { create } from 'zustand';
import { newId, nowIso } from '../../shared/ids';
import { defaultExportConfig, type ExportConfig, type ModelRecord, type Project } from '../../shared/types';
import { describeStorageError, defaultProject } from '../../storage/ProjectStore';
import { getDb } from './db';

export type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

interface StudioState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  project: Project;
  models: ModelRecord[];
  save: { state: SaveState; lastSavedAt: number | null; error: string | null };
  persistent: boolean | null;

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
}

const dirtyModels = new Set<string>();
let projectDirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;

export const useStudio = create<StudioState>((set, get) => {
  const schedule = () => {
    set((s) => ({ save: { ...s.save, state: 'dirty', error: null } }));
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void get().flush(), 450);
  };

  return {
    status: 'loading',
    error: null,
    project: defaultProject(),
    models: [],
    save: { state: 'saved', lastSavedAt: null, error: null },
    persistent: null,

    async init() {
      try {
        const db = await getDb();
        const [project, models] = await Promise.all([db.getProject(), db.listModels()]);
        // Drop selections whose model no longer exists.
        const ids = new Set(models.map((m) => m.id));
        const selected = project.exportConfig.selectedModelIds.filter((id) => ids.has(id));
        if (selected.length !== project.exportConfig.selectedModelIds.length) {
          project.exportConfig = { ...project.exportConfig, selectedModelIds: selected };
          projectDirty = true;
        }
        set({ status: 'ready', project, models, error: null });
        if (projectDirty) schedule();
        navigator.storage?.persisted?.().then((p) => set({ persistent: p }), () => undefined);
      } catch (e) {
        set({ status: 'error', error: describeStorageError(e) });
      }
    },

    async reload() {
      await get().flush();
      const db = await getDb();
      const [project, models] = await Promise.all([db.getProject(), db.listModels()]);
      set({ project, models });
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
          await db.putModels(models.filter((m) => ids.includes(m.id)));
          if (wasProjectDirty) await db.putProject(project);
          set((s) => ({ save: { state: dirtyModels.size || projectDirty ? 'dirty' : 'saved', lastSavedAt: Date.now(), error: null } , models: s.models }));
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
  };
});

export function hasUnsavedWork(): boolean {
  const s = useStudio.getState().save.state;
  return s === 'dirty' || s === 'saving' || s === 'error';
}

export function selectedModels(state: Pick<StudioState, 'models' | 'project'>): ModelRecord[] {
  const byId = new Map(state.models.map((m) => [m.id, m]));
  return state.project.exportConfig.selectedModelIds.map((id) => byId.get(id)).filter((m): m is ModelRecord => !!m);
}

export { defaultExportConfig };
