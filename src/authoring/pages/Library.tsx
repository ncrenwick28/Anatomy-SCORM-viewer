import { useMemo, useState } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Copy, FolderTree, MoreHorizontal, Package, Pencil, Plus, Search, Sparkles, Trash2, Upload } from 'lucide-react';
import type { ModelRecord } from '../../shared/types';
import { toPlainText } from '../../shared/richtext';
import { AssetThumb } from '../components/AssetThumb';
import { CategoriesDialog } from '../components/CategoriesDialog';
import { ImportDialog } from '../components/ImportDialog';
import { Modal, useConfirm } from '../components/Modal';
import { ModelFormDialog } from '../components/ModelFormDialog';
import { loadDemoContent, type ImportProgress } from '../pipeline';
import { useStudio } from '../state/store';
import { toast } from '../state/toasts';

const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function LibraryPage({ onOpenModel, onGoExport }: { onOpenModel: (id: string) => void; onGoExport: () => void }) {
  const models = useStudio((s) => s.models);
  const project = useStudio((s) => s.project);
  const selected = project.exportConfig.selectedModelIds;
  const toggleSelected = useStudio((s) => s.toggleSelected);
  const updateExportConfig = useStudio((s) => s.updateExportConfig);
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [regionF, setRegionF] = useState<string[]>([]);
  const [systemF, setSystemF] = useState<string[]>([]);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [sort, setSort] = useState<'newest' | 'az'>('newest');
  const [importOpen, setImportOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState<ImportProgress | 'start' | null>(null);

  const matches = (m: ModelRecord, skip?: 'region' | 'system') => {
    const needle = q.trim().toLowerCase();
    if (needle && !(m.title.toLowerCase().includes(needle) || toPlainText(m.description).toLowerCase().includes(needle))) return false;
    if (skip !== 'region' && regionF.length && !regionF.some((r) => m.regionIds.includes(r))) return false;
    if (skip !== 'system' && systemF.length && !systemF.some((s) => m.systemIds.includes(s))) return false;
    if (selectedOnly && !selected.includes(m.id)) return false;
    return true;
  };
  const visible = useMemo(() => {
    const list = models.filter((m) => matches(m));
    return sort === 'az' ? [...list].sort((a, b) => a.title.localeCompare(b.title, 'en-GB')) : [...list].reverse();
  }, [models, q, regionF, systemF, selectedOnly, selected, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (kind: 'region' | 'system', id: string) => models.filter((m) => matches(m, kind) && (kind === 'region' ? m.regionIds : m.systemIds).includes(id)).length;
  const filtering = !!(q || regionF.length || systemF.length || selectedOnly);
  const clearFilters = () => (setQ(''), setRegionF([]), setSystemF([]), setSelectedOnly(false));

  const remove = async (m: ModelRecord) => {
    const ok = await confirm({
      title: `Delete “${m.title}”?`,
      message: (
        <>
          <p>This permanently removes the model, its {m.annotations.length} annotation{m.annotations.length === 1 ? '' : 's'}, saved views and stored files from this browser. It cannot be undone.</p>
          <p className="hint">Tip: download a project backup first if you may need it again.</p>
        </>
      ),
      confirmLabel: 'Delete model',
      danger: true,
    });
    if (!ok) return;
    try {
      await useStudio.getState().removeModel(m.id);
      toast.ok(`Deleted “${m.title}”.`);
    } catch (e) {
      toast.error(`Could not delete the model: ${(e as Error).message}`);
    }
  };
  const duplicate = async (m: ModelRecord) => {
    const id = await useStudio.getState().duplicateModel(m.id);
    if (id) toast.ok(`Duplicated “${m.title}”. Both copies share the same model file.`);
  };
  const demo = async () => {
    setDemoBusy('start');
    try {
      const n = await loadDemoContent(setDemoBusy);
      toast.ok(n ? `Added ${n} demonstration model${n === 1 ? '' : 's'}.` : 'The demonstration models are already in your library.');
    } catch (e) {
      toast.error(`Could not load the demonstration content: ${(e as Error).message}`);
    } finally {
      setDemoBusy(null);
    }
  };
  const selectAllShown = () => updateExportConfig({ selectedModelIds: [...selected, ...visible.map((m) => m.id).filter((id) => !selected.includes(id))] });
  const allShownSelected = visible.length > 0 && visible.every((m) => selected.includes(m.id));

  const toggleIn = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div className="lib">
      <div className="page-head">
        <div>
          <h1>Model library</h1>
          <p className="hint">{models.length} model{models.length === 1 ? '' : 's'} · {selected.length} selected for export</p>
        </div>
        <div className="page-head__actions">
          <button type="button" className="btn" onClick={() => setCatsOpen(true)}><FolderTree /> Regions and systems</button>
          <button type="button" className="btn btn--primary" onClick={() => setImportOpen(true)} data-testid="import-open"><Upload /> Import models</button>
        </div>
      </div>

      {models.length === 0 ? (
        <section className="empty-state" aria-labelledby="empty-title" data-testid="library-empty">
          <Package size={44} aria-hidden="true" />
          <h2 id="empty-title">Your library is empty</h2>
          <p>Import GLB or glTF models, organise them by body region and system, add annotations, then export a SCORM package for your LMS.</p>
          <div className="empty-state__actions">
            <button type="button" className="btn btn--primary" onClick={() => setImportOpen(true)}><Upload /> Import a model</button>
            <button type="button" className="btn" onClick={() => void demo()} disabled={!!demoBusy} data-testid="load-demo"><Sparkles /> Load demonstration models</button>
          </div>
          <p className="hint">The demonstration models are simplified schematic shapes generated for this software (CC0). They are not anatomically accurate.</p>
        </section>
      ) : (
        <div className="lib-body">
          <aside className="lib-filters" aria-label="Filters">
            <div className="field">
              <label htmlFor="lib-q" className="sr-only">Search models</label>
              <div className="search-box"><Search size={16} aria-hidden="true" /><input id="lib-q" className="input" type="search" placeholder="Search models…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="library-search" /></div>
            </div>
            <fieldset className="filter-group">
              <legend>Body region</legend>
              {project.regions.map((r) => (
                <label key={r.id} className="check filter-check"><input type="checkbox" checked={regionF.includes(r.id)} onChange={() => toggleIn(regionF, setRegionF, r.id)} /><span>{r.name}</span><em>{count('region', r.id)}</em></label>
              ))}
            </fieldset>
            <fieldset className="filter-group">
              <legend>Body system</legend>
              {project.systems.map((s) => (
                <label key={s.id} className="check filter-check"><input type="checkbox" checked={systemF.includes(s.id)} onChange={() => toggleIn(systemF, setSystemF, s.id)} /><span>{s.name}</span><em>{count('system', s.id)}</em></label>
              ))}
            </fieldset>
            <label className="check filter-check selected-only"><input type="checkbox" checked={selectedOnly} onChange={(e) => setSelectedOnly(e.target.checked)} data-testid="filter-selected" /><span>Only models selected for export</span><em>{selected.length}</em></label>
            {filtering && <button type="button" className="btn btn--sm" onClick={clearFilters}>Clear all filters</button>}
          </aside>

          <section className="lib-main" aria-labelledby="lib-results">
            <div className="lib-toolbar">
              <h2 id="lib-results" className="sr-only">Models</h2>
              <span className="hint" role="status" aria-live="polite" data-testid="library-count">{visible.length} of {models.length} shown</span>
              <div className="lib-toolbar__right">
                <label className="sr-only" htmlFor="lib-sort">Sort</label>
                <select id="lib-sort" className="select select--sm" value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'az')}>
                  <option value="newest">Newest first</option>
                  <option value="az">Title A–Z</option>
                </select>
                <button type="button" className="btn btn--sm" onClick={allShownSelected ? () => updateExportConfig({ selectedModelIds: selected.filter((id) => !visible.some((m) => m.id === id)) }) : selectAllShown} disabled={!visible.length}>
                  {allShownSelected ? 'Deselect shown' : 'Select all shown'}
                </button>
                <button type="button" className="btn btn--sm btn--primary" onClick={onGoExport} disabled={!selected.length} data-testid="go-export">
                  <Package /> Export {selected.length ? `${selected.length} selected` : 'selected'}…
                </button>
              </div>
            </div>
            {visible.length === 0 ? (
              <div className="empty-inline" role="status">
                <p><strong>No models match your filters.</strong></p>
                <button type="button" className="btn btn--sm" onClick={clearFilters}>Clear filters</button>
              </div>
            ) : (
              <ul className="model-grid" data-testid="model-grid">
                {visible.map((m) => {
                  const isSel = selected.includes(m.id);
                  const rn = project.regions.filter((r) => m.regionIds.includes(r.id)).map((r) => r.name);
                  const sn = project.systems.filter((s) => m.systemIds.includes(s.id)).map((s) => s.name);
                  return (
                    <li key={m.id}>
                      <article className={`model-card ${isSel ? 'is-selected' : ''}`} data-model-id={m.id} data-testid="model-card">
                        <button type="button" className="model-card__thumb" onClick={() => onOpenModel(m.id)} aria-label={`Open ${m.title}`}>
                          <AssetThumb id={m.thumbnailAssetId} />
                        </button>
                        <label className="model-card__select">
                          <input type="checkbox" checked={isSel} onChange={() => toggleSelected(m.id)} data-testid="select-model" />
                          <span className="sr-only">Include “{m.title}” in the export</span>
                          <span className="model-card__tick" aria-hidden="true">{isSel ? '✓' : ''}</span>
                        </label>
                        <div className="model-card__body">
                          <h3><button type="button" className="link-button" onClick={() => onOpenModel(m.id)}>{m.title}</button></h3>
                          <div className="chips">
                            {[...rn, ...sn].length ? [...rn.map((n) => ['r', n]), ...sn.map((n) => ['s', n])].slice(0, 5).map(([k, n]) => <span key={k + n} className={`chip ${k === 'r' ? 'chip--accent' : ''}`}>{n}</span>) : <span className="chip chip--warn">Uncategorised</span>}
                            {rn.length + sn.length > 5 && <span className="chip">+{rn.length + sn.length - 5}</span>}
                          </div>
                          <p className="model-card__meta">{m.annotations.length} annotation{m.annotations.length === 1 ? '' : 's'} · {fmtBytes(m.stats.totalBytes)}{m.isDemo ? ' · Demo' : ''}{!m.view.camera ? ' · No default view' : ''}</p>
                        </div>
                        <div className="model-card__actions">
                          <button type="button" className="btn btn--sm" onClick={() => onOpenModel(m.id)}>Open</button>
                          <Menu.Root>
                            <Menu.Trigger asChild><button type="button" className="btn btn--sm btn--icon" aria-label={`More actions for ${m.title}`} data-testid="card-menu"><MoreHorizontal /></button></Menu.Trigger>
                            <Menu.Portal>
                              <Menu.Content className="menu" align="end" sideOffset={4}>
                                <Menu.Item className="menu-item" onSelect={() => setEditId(m.id)} data-testid="card-edit"><Pencil /> Edit details</Menu.Item>
                                <Menu.Item className="menu-item" onSelect={() => void duplicate(m)} data-testid="card-duplicate"><Copy /> Duplicate</Menu.Item>
                                <Menu.Separator className="menu-sep" />
                                <Menu.Item className="menu-item menu-item--danger" onSelect={() => void remove(m)} data-testid="card-delete"><Trash2 /> Delete…</Menu.Item>
                              </Menu.Content>
                            </Menu.Portal>
                          </Menu.Root>
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            )}
            {!models.some((m) => m.isDemo) && (
              <p className="hint demo-hint"><button type="button" className="link-button" onClick={() => void demo()} disabled={!!demoBusy}><Plus size={14} /> Add the demonstration models</button> (schematic, CC0)</p>
            )}
          </section>
        </div>
      )}

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <CategoriesDialog open={catsOpen} onOpenChange={setCatsOpen} />
      <ModelFormDialog modelId={editId} open={!!editId} onOpenChange={(o) => !o && setEditId(null)} />
      <Modal open={!!demoBusy} onOpenChange={() => undefined} locked title="Loading demonstration models">
        <p role="status"><span className="spinner" /> {demoBusy && demoBusy !== 'start' ? `${demoBusy.stage}: ${demoBusy.title} (${demoBusy.index + 1} of ${demoBusy.total})` : 'Starting…'}</p>
      </Modal>
    </div>
  );
}
