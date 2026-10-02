import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, Crosshair, Eye, EyeOff, Info, Layers, MapPin, Pencil, PlayCircle, Plus, Redo2, Save, Sun, Undo2 } from 'lucide-react';
import { buildPreviewContent } from '../../export/previewContent';
import { Player } from '../../player/Player';
import { ProgressTracker } from '../../player/tracker';
import { newId, nowIso } from '../../shared/ids';
import { LIMITS, type Annotation, type AnnotationAnchor } from '../../shared/types';
import { AnnotationList } from '../../ui/AnnotationPanel';
import { useFullscreen } from '../../ui/hooks';
import { StructurePanel } from '../../ui/StructurePanel';
import { Viewport } from '../../ui/Viewport';
import type { StructureNode } from '../../viewer/meshKeys';
import type { MarkerState, ModelSource, PickResult } from '../../viewer/types';
import type { ViewerCore } from '../../viewer/ViewerCore';
import { AnnotationEditor } from '../components/AnnotationEditor';
import { AppearancePanel } from '../components/AppearancePanel';
import { useConfirm } from '../components/Modal';
import { ModelFormDialog, ModelInfoList } from '../components/ModelFormDialog';
import { regenerateThumbnail } from '../pipeline';
import { assetUrl, openModelSource } from '../state/assets';
import { useStudio } from '../state/store';
import { toast } from '../state/toasts';
import { patchAnnotation, useAnnotationHistory } from '../state/useHistory';

type Mode = 'view' | 'place' | 'move';

export function WorkspacePage({ modelId, onBack, onGoExport }: { modelId: string; onBack: () => void; onGoExport: () => void }) {
  const model = useStudio((s) => s.models.find((m) => m.id === modelId) ?? null);
  const project = useStudio((s) => s.project);
  const updateModel = useStudio((s) => s.updateModel);
  const confirm = useConfirm();
  const history = useAnnotationHistory(modelId);
  const viewerRef = useRef<ViewerCore | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const fullscreen = useFullscreen(stageRef);

  const [source, setSource] = useState<ModelSource | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [structure, setStructure] = useState<StructureNode[]>([]);
  const [tick, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, MarkerState>>({});
  const [mode, setMode] = useState<Mode>('view');
  const [showMarkers, setShowMarkers] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [tab, setTab] = useState('annotations');
  const [editOpen, setEditOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [savingView, setSavingView] = useState(false);
  const [viewDirty, setViewDirty] = useState(false);
  const [cameraChanged, setCameraChanged] = useState(false);
  const [announce, setAnnounce] = useState('');

  // Open the model's files as blob URLs for the viewer.
  useEffect(() => {
    if (!model) return;
    let alive = true;
    let dispose: (() => void) | null = null;
    setSource(null);
    setSourceError(null);
    openModelSource(model).then(
      (r) => {
        if (!alive) return r.dispose();
        dispose = r.dispose;
        setSource(r.source);
      },
      (e) => alive && setSourceError((e as Error).message),
    );
    return () => {
      alive = false;
      dispose?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, model?.assets.map((a) => a.id).join()]);

  useEffect(() => {
    setSelectedId(null);
    setMode('view');
    setViewDirty(false);
  }, [modelId]);

  const annotations = model?.annotations ?? [];
  const selectedIdx = annotations.findIndex((a) => a.id === selectedId);
  const selected = selectedIdx >= 0 ? annotations[selectedIdx] : null;
  const categories = useMemo(() => [...new Set(annotations.map((a) => a.category).filter(Boolean))], [annotations]);

  const place = useCallback(
    (anchor: AnnotationAnchor) => {
      if (!model) return;
      if (model.annotations.length >= LIMITS.maxAnnotationsPerModel) return void toast.error(`A model can have at most ${LIMITS.maxAnnotationsPerModel} annotations.`);
      const now = nowIso();
      const a: Annotation = { id: newId('ann'), label: `New annotation ${model.annotations.length + 1}`, description: '', category: '', link: null, required: true, anchor, createdAt: now, updatedAt: now };
      // Typing the first label straight after creating merges into the creation step, so one Undo removes it.
      history.commit([...model.annotations, a], `${a.id}:label`);
      setSelectedId(a.id);
      setTab('annotations');
      setMode('view');
      setAnnounce(`Annotation ${model.annotations.length + 1} added. Edit its label and description.`);
      requestAnimationFrame(() => {
        labelRef.current?.focus();
        labelRef.current?.select();
      });
    },
    [model, history],
  );

  const reposition = useCallback(
    (anchor: AnnotationAnchor) => {
      if (!model || !selectedId) return;
      history.commit(patchAnnotation(model.annotations, selectedId, { anchor }));
      setMode('view');
      setAnnounce('Annotation moved.');
    },
    [model, selectedId, history],
  );

  const onPick = (r: PickResult | null) => {
    if (!r) {
      toast.info('That click did not land on the model. Click directly on its surface.');
      return;
    }
    if (mode === 'place') place(r.anchor);
    else if (mode === 'move') reposition(r.anchor);
  };

  const pickCentre = (kind: 'place' | 'move') => {
    const anchor = viewerRef.current?.pickAtCentre();
    if (!anchor) return toast.error('The centre of the view is not on the model. Rotate or zoom so the model is in the middle of the viewport.');
    if (kind === 'place') place(anchor);
    else reposition(anchor);
  };

  const deleteSelected = async () => {
    if (!model || !selected) return;
    const ok = await confirm({ title: `Delete annotation “${selected.label || selectedIdx + 1}”?`, message: 'You can bring it back with Undo straight afterwards.', confirmLabel: 'Delete annotation', danger: true });
    if (!ok) return;
    history.commit(model.annotations.filter((a) => a.id !== selected.id));
    setSelectedId(null);
    setAnnounce('Annotation deleted. Use Undo to restore it.');
  };

  const select = (id: string | null, fromList = false) => {
    setSelectedId(id);
    setMode((m) => (m === 'move' ? 'view' : m));
    if (id) {
      setTab('annotations');
      if (fromList) viewerRef.current?.ensureMarkerVisible(id);
    }
  };

  const saveView = async () => {
    const v = viewerRef.current;
    if (!v || !model) return;
    setSavingView(true);
    try {
      const camera = v.getCameraView();
      const hidden = v.getIsolatedKey() !== null ? v.getEffectiveHiddenMeshKeys() : v.getHiddenKeys();
      updateModel(model.id, (m) => ({ ...m, view: { ...m.view, camera, hiddenMeshKeys: hidden } }));
      v.setDefaultView(camera);
      await regenerateThumbnail(model.id, v);
      setViewDirty(false);
      setCameraChanged(false);
      toast.ok('Default view saved and thumbnail updated. Students will open the model from this view.');
    } catch (e) {
      toast.error(`The default view could not be saved: ${(e as Error).message}`);
    } finally {
      setSavingView(false);
    }
  };

  // Keyboard: Escape cancels placing; Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo and redo (outside text fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === 'Escape' && mode !== 'view') {
        setMode('view');
        e.stopPropagation();
      } else if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        (e.shiftKey ? history.redo : history.undo)();
      } else if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        history.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, history]);

  const previewContent = useMemo(() => (model ? buildPreviewContent(project.exportConfig, project.regions, project.systems, [model]) : null), [model, project]);
  const previewTracker = useMemo(() => new ProgressTracker(previewContent ?? ({ packageId: 'x', contentHash: 'x', completion: 'open-all', models: [] } as never), { api: null, storage: null }), [previewContent]);
  useEffect(() => {
    if (previewing) previewTracker.start();
  }, [previewing, previewTracker]);
  const resolveAsset = useCallback(async (path: string) => (path.startsWith('asset:') ? (await assetUrl(path.slice(6))) ?? '' : path), []);

  if (!model) {
    return (
      <div className="empty-state">
        <h2>This model no longer exists</h2>
        <p>It may have been deleted in another tab.</p>
        <button type="button" className="btn btn--primary" onClick={onBack}>Back to the library</button>
      </div>
    );
  }

  if (previewing && previewContent) {
    return <Player content={previewContent} tracker={previewTracker} resolveAsset={resolveAsset} dracoPath={`${import.meta.env.BASE_URL}lib/draco/`} initialModelId={model.id} preview={{ onExit: () => setPreviewing(false), label: 'Student preview' }} />;
  }

  const labelFor = (a: Annotation, i: number) => a.label.trim() || `Annotation ${i + 1}`;
  const savedCamera = model.view.camera;

  return (
    <div className="ws">
      <div className="ws-bar">
        <button type="button" className="btn btn--sm" onClick={onBack}><ArrowLeft /> Library</button>
        <div className="ws-bar__title">
          <h1>{model.title}</h1>
          <span className="hint">{model.annotations.length} annotation{model.annotations.length === 1 ? '' : 's'} · {savedCamera ? (cameraChanged ? 'View differs from the saved default' : 'Default view saved') : 'No default view saved yet'}</span>
        </div>
        <div className="ws-bar__actions">
          <button type="button" className="btn btn--sm" onClick={() => setEditOpen(true)} data-testid="edit-details"><Pencil /> Details</button>
          <button type="button" className="btn btn--sm" onClick={() => setPreviewing(true)} data-testid="student-preview"><PlayCircle /> Student preview</button>
          <button type="button" className="btn btn--sm btn--primary" onClick={() => void saveView()} disabled={savingView || !source} data-testid="save-view"><Save /> {savingView ? 'Saving…' : 'Save as default view'}</button>
          <button type="button" className="btn btn--sm" onClick={onGoExport}>Export…</button>
        </div>
      </div>

      <div className="ws-main" ref={stageRef}>
        <div className="ws-stage">
          {sourceError ? (
            <div className="callout callout--error" role="alert" style={{ margin: 24 }}><span>{sourceError}</span></div>
          ) : (
            <Viewport
              ariaLabel={`3D model: ${model.title}`}
              source={source}
              sourceKey={`${model.id}:${model.assets.map((a) => a.id).join()}`}
              annotations={annotations}
              selectedId={selectedId}
              showMarkers={showMarkers}
              showHiddenMarkers={showHidden}
              view={model.view}
              labelFor={labelFor}
              pickMode={mode !== 'view'}
              viewerRef={viewerRef}
              dracoPath={`${import.meta.env.BASE_URL}lib/draco/`}
              fullscreen={fullscreen}
              onLoaded={(info) => setStructure(info.structure)}
              onMarkerClick={(id) => select(id)}
              onBackgroundClick={() => undefined}
              onPick={onPick}
              onMarkerStates={setStates}
              onVisibility={() => { setTick((t) => t + 1); setViewDirty(true); }}
              onCameraMoved={() => {
                const v = viewerRef.current;
                const saved = model.view.camera;
                if (!v || !saved) return;
                const c = v.getCameraView();
                const d = Math.hypot(c.position[0] - saved.position[0], c.position[1] - saved.position[1], c.position[2] - saved.position[2]) + Math.hypot(c.target[0] - saved.target[0], c.target[1] - saved.target[1], c.target[2] - saved.target[2]);
                setCameraChanged(d > 1e-3 * Math.max(1, v.getBounds().radius));
              }}
              overlay={
                <div className="ws-tools" role="toolbar" aria-label="Annotation tools">
                  <button type="button" className="btn btn--sm btn--primary" aria-pressed={mode === 'place'} onClick={() => setMode((m) => (m === 'place' ? 'view' : 'place'))} data-testid="add-annotation"><Plus /> Add annotation</button>
                  <button type="button" className="btn btn--sm" onClick={() => pickCentre('place')} title="Adds a marker at the point in the centre of the viewport. A keyboard-friendly alternative to clicking." data-testid="add-at-centre"><Crosshair /> Add at centre</button>
                  <button type="button" className="btn btn--sm btn--icon" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo annotation change" title="Undo (Ctrl+Z)" data-testid="undo"><Undo2 /></button>
                  <button type="button" className="btn btn--sm btn--icon" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo annotation change" title="Redo (Ctrl+Shift+Z)" data-testid="redo"><Redo2 /></button>
                  <button type="button" className="btn btn--sm" aria-pressed={showMarkers} onClick={() => setShowMarkers((v) => !v)}><MapPin /> {showMarkers ? 'Hide markers' : 'Show markers'}</button>
                  {showMarkers && <button type="button" className="btn btn--sm" aria-pressed={showHidden} onClick={() => setShowHidden((v) => !v)} title="Show markers on the far side of the model as faint dashed circles">{showHidden ? <Eye /> : <EyeOff />} Markers behind</button>}
                </div>
              }
            />
          )}
          {mode !== 'view' && (
            <div className="ws-banner" role="status" data-testid="mode-banner">
              <strong>{mode === 'place' ? 'Click on the model to place the marker' : `Click the model to move “${selected?.label ?? 'the marker'}”`}</strong>
              <span>Drag to rotate first if the spot is not visible. Press Esc to cancel.</span>
              <button type="button" className="btn btn--sm" onClick={() => setMode('view')}>Cancel</button>
            </div>
          )}
          <p className="sr-only" role="status" aria-live="polite">{announce}</p>
        </div>

        <aside className="ws-panel" aria-label="Model tools">
          <Tabs.Root value={tab} onValueChange={setTab} className="ws-tabs">
            <Tabs.List className="tabs-list" aria-label="Panels">
              <Tabs.Trigger className="tab" value="annotations" data-testid="tab-annotations"><MapPin size={16} aria-hidden="true" /> Annotations <span className="pl-count">{annotations.length}</span></Tabs.Trigger>
              <Tabs.Trigger className="tab" value="structures" data-testid="tab-structures"><Layers size={16} aria-hidden="true" /> Structures</Tabs.Trigger>
              <Tabs.Trigger className="tab" value="appearance" data-testid="tab-appearance"><Sun size={16} aria-hidden="true" /> Appearance</Tabs.Trigger>
              <Tabs.Trigger className="tab" value="info" data-testid="tab-info"><Info size={16} aria-hidden="true" /> Info</Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="annotations" className="ws-tabpanel ws-tabpanel--ann">
              <div className="ws-ann-list">
                <AnnotationList
                  annotations={annotations}
                  selectedId={selectedId}
                  onSelect={(id) => select(id, true)}
                  states={states}
                  idPrefix="ws-ann"
                  empty={
                    <div className="ann-empty-state">
                      <MapPin size={28} aria-hidden="true" />
                      <p><strong>No annotations yet</strong></p>
                      <p className="hint">Choose “Add annotation”, then click the point on the model you want to label. Use “Add at centre” if you prefer the keyboard.</p>
                    </div>
                  }
                />
              </div>
              {selected && (
                <div className="ws-ann-edit">
                  <AnnotationEditor
                    key={selected.id}
                    annotation={selected}
                    index={selectedIdx}
                    categories={categories}
                    state={states[selected.id]}
                    moving={mode === 'move'}
                    labelRef={labelRef}
                    onChange={(patch, key) => history.commit(patchAnnotation(model.annotations, selected.id, patch), key)}
                    onDelete={() => void deleteSelected()}
                    onToggleMove={() => setMode((m) => (m === 'move' ? 'view' : 'move'))}
                    onMoveToCentre={() => pickCentre('move')}
                    onFocusOnModel={() => viewerRef.current?.focusAnnotation(selected.id, true)}
                  />
                </div>
              )}
            </Tabs.Content>

            <Tabs.Content value="structures" className="ws-tabpanel">
              <StructurePanel
                viewer={viewerRef.current}
                structure={structure}
                labels={model.meshLabels}
                tick={tick}
                onRename={(key, name) => updateModel(model.id, (m) => { const labels = { ...m.meshLabels }; if (name) labels[key] = name; else delete labels[key]; return { ...m, meshLabels: labels }; })}
              />
              <p className="hint" style={{ marginTop: 12 }}>Hidden structures are saved with the default view. Annotations on hidden structures are hidden too. Renaming only changes the name students see.</p>
            </Tabs.Content>

            <Tabs.Content value="appearance" className="ws-tabpanel">
              <AppearancePanel
                background={model.view.background}
                lighting={model.view.lighting}
                onBackground={(background) => { updateModel(model.id, (m) => ({ ...m, view: { ...m.view, background } })); viewerRef.current?.setBackground(background); setViewDirty(true); }}
                onLighting={(lighting) => { updateModel(model.id, (m) => ({ ...m, view: { ...m.view, lighting } })); viewerRef.current?.setLighting(lighting); setViewDirty(true); }}
              />
              {viewDirty && <div className="callout callout--info" role="status"><span>Appearance changes are saved automatically. Choose “Save as default view” to refresh the thumbnail.</span></div>}
            </Tabs.Content>

            <Tabs.Content value="info" className="ws-tabpanel">
              <div className="btn-row" style={{ marginBottom: 12 }}>
                <button type="button" className="btn btn--sm" onClick={() => setEditOpen(true)}><Pencil /> Edit title, description and categories</button>
              </div>
              <ModelInfoList model={model} />
              <h4 style={{ margin: '16px 0 8px' }}>Default view</h4>
              <p className="hint">{savedCamera ? 'A default view is saved. “Reset view” returns to it, and students open the model from it.' : 'No default view saved yet. Rotate and zoom to a good starting view, then choose “Save as default view”.'}</p>
            </Tabs.Content>
          </Tabs.Root>
        </aside>
      </div>
      <ModelFormDialog modelId={model.id} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}
