import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, Eye, EyeOff, MapPin, Info, Layers, GraduationCap } from 'lucide-react';
import type { PackageContent, PackageModel } from '../shared/content';
import { AnnotationDetail, AnnotationList } from '../ui/AnnotationPanel';
import { AssetResolverContext } from '../ui/Assets';
import { useFullscreen } from '../ui/hooks';
import { RichText } from '../ui/RichText';
import { StructurePanel } from '../ui/StructurePanel';
import { Viewport } from '../ui/Viewport';
import type { StructureNode } from '../viewer/meshKeys';
import type { MarkerState, ModelSource } from '../viewer/types';
import type { ViewerCore } from '../viewer/ViewerCore';
import type { ProgressTracker, TrackerState } from './tracker';
import { QuizPanel, useQuiz } from './Quiz';

interface Props {
  content: PackageContent;
  model: PackageModel;
  index: number;
  state: TrackerState;
  tracker: ProgressTracker;
  dracoPath?: string;
  onBack: () => void;
  onNavigate: (id: string) => void;
}

export function ModelView({ content, model, index, state, tracker, dracoPath, onBack, onNavigate }: Props) {
  const f = content.features;
  const resolve = useContext(AssetResolverContext);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ViewerCore | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const detailWrapRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(stageRef);
  const [source, setSource] = useState<ModelSource | null>(null);
  const [structure, setStructure] = useState<StructureNode[]>([]);
  const [tick, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, MarkerState>>({});
  const [showMarkers, setShowMarkers] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [tab, setTab] = useState('about');
  const annotations = model.annotations;
  const hasAnnotations = annotations.length > 0;
  // The quiz only asks about structures that are visible in the author's default view, so every question can be answered.
  const quizPool = useMemo(() => {
    const hidden = model.view.hiddenMeshKeys;
    return annotations.filter((a) => !hidden.some((k) => a.anchor.meshKey === k || a.anchor.meshKey.startsWith(`${k}/`)));
  }, [annotations, model.view.hiddenMeshKeys]);
  const quiz = useQuiz(quizPool);
  const quizAvailable = f.selfStudy && quizPool.length > 0;
  const quizOn = quizAvailable && tab === 'quiz';
  const viewed = useMemo(() => new Set(state.progress.viewed[model.id] ?? []), [state.progress.viewed, model.id]);

  // Reset per-model state when switching models.
  useEffect(() => {
    setSelectedId(null);
    quiz.reset();
    setShowHidden(false);
    setShowMarkers(true);
    setStructure([]);
    setStates({});
    setTab('about');
    headingRef.current?.focus();
    document.title = `${model.title} – ${content.title}`;
    return () => void (document.title = content.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.id, model.title, content.title]);

  // Resolve every file of the model to a loadable URL.
  useEffect(() => {
    let alive = true;
    setSource(null);
    Promise.all(Object.entries(model.files).map(async ([name, path]) => [name, await resolve(path)] as const)).then((pairs) => {
      if (alive) setSource({ entryName: Object.keys(model.files).find((n) => model.files[n] === model.entry) ?? model.entry.split('/').pop()!, format: model.format, urls: Object.fromEntries(pairs) });
    });
    return () => {
      alive = false;
    };
  }, [model, resolve]);

  // An annotation counts as "viewed" only once its label and description are actually on screen: the detail
  // card lives in the Annotations tab, so that tab must be showing. (The quiz does not count towards completion.)
  useEffect(() => {
    if (!selectedId || tab !== 'annotations') return;
    if (annotations.some((x) => x.id === selectedId)) tracker.viewAnnotation(model.id, selectedId);
  }, [selectedId, tab, annotations, tracker, model.id]);

  // Quiz feedback: make sure the answer is in view (the marker is drawn by the Viewport on the next effect pass).
  const quizShownId = quizOn ? quiz.selectedId : null;
  const quizPhase = quiz.state.phase;
  useEffect(() => {
    if (!quizShownId) return;
    const t = setTimeout(() => viewerRef.current?.ensureMarkerVisible(quizShownId), 60);
    return () => clearTimeout(t);
  }, [quizShownId, quizPhase]);
  const showOnModel = useCallback((id: string) => {
    setTimeout(() => viewerRef.current?.focusAnnotation(id, true), 80);
  }, []);

  const select = useCallback(
    (id: string | null, fromList = false) => {
      setSelectedId(id);
      // The detail card is in the Annotations tab (with or without the list), so always show it.
      if (id) setTab('annotations');
      if (id && fromList) viewerRef.current?.ensureMarkerVisible(id);
      if (id) requestAnimationFrame(() => detailWrapRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    },
    [],
  );

  const selectedIdx = selectedId ? annotations.findIndex((a) => a.id === selectedId) : -1;
  const selected = selectedIdx >= 0 ? annotations[selectedIdx] : null;
  const prevNext = (d: number) => {
    const n = annotations.length;
    if (!n) return;
    const next = annotations[(selectedIdx + d + n) % n];
    select(next.id, true);
  };

  const modelIdx = content.models.findIndex((m) => m.id === model.id);
  const showStructures = f.structureList && structure.length > 0 && model.stats.meshCount > 1;
  const regionNames = content.regions.filter((r) => model.regionIds.includes(r.id)).map((r) => r.name);
  const systemNames = content.systems.filter((s) => model.systemIds.includes(s.id)).map((s) => s.name);

  const overlay = (
    <div className="pl-vp-tools">
      {hasAnnotations && !quizOn && (
        <>
          <button type="button" className={`btn btn--sm ${showMarkers ? 'is-on' : ''}`} onClick={() => setShowMarkers((v) => !v)}>
            <MapPin /> {showMarkers ? 'Hide annotations' : 'Show annotations'}
          </button>
          {showMarkers && (
            <button type="button" className="btn btn--sm" aria-pressed={showHidden} onClick={() => setShowHidden((v) => !v)} title="Also show markers that are on the far side of the model, as faint dashed circles">
              {showHidden ? <Eye /> : <EyeOff />} Markers behind the model
            </button>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="pl-modelview">
      <div className="pl-modelbar">
        <button type="button" className="btn" onClick={onBack}><ArrowLeft /> Back to gallery</button>
        <div className="pl-modelbar__title">
          <h1 ref={headingRef} tabIndex={-1}>{model.title}</h1>
          <span className="hint">Model {modelIdx + 1} of {content.models.length}</span>
        </div>
        {content.models.length > 1 && (
          <div className="pl-modelnav">
            <button type="button" className="btn btn--sm" disabled={modelIdx <= 0} onClick={() => onNavigate(content.models[modelIdx - 1].id)}>Previous model</button>
            <button type="button" className="btn btn--sm" disabled={modelIdx >= content.models.length - 1} onClick={() => onNavigate(content.models[modelIdx + 1].id)}>Next model</button>
          </div>
        )}
      </div>

      <div className="pl-stage" ref={stageRef}>
        <Viewport
          className="pl-stage__vp"
          ariaLabel={`3D model: ${model.title}`}
          source={source}
          sourceKey={`${model.id}`}
          annotations={quizOn ? quiz.viewAnnotations : annotations}
          selectedId={quizOn ? quiz.selectedId : selectedId}
          showMarkers={quizOn || showMarkers}
          showHiddenMarkers={!quizOn && showHidden}
          pickMode={quizOn && quiz.picking}
          onPick={(r) => quizOn && quiz.picking && quiz.pick(r ? { meshKey: r.anchor.meshKey, position: r.anchor.position } : null)}
          view={model.view}
          dracoPath={dracoPath}
          viewerRef={viewerRef}
          fullscreen={f.fullscreen ? fullscreen : null}
          overlay={overlay}
          onLoaded={(info) => {
            setStructure(info.structure);
            tracker.openModel(model.id);
          }}
          onMarkerClick={(id) => !quizOn && select(id)}
          onBackgroundClick={() => undefined}
          onMarkerStates={setStates}
          onVisibility={() => setTick((t) => t + 1)}
        />
        <aside className="pl-panel" aria-label="Model information">
          <Tabs.Root value={tab} onValueChange={setTab} className="pl-tabs">
            <Tabs.List className="tabs-list" aria-label="Model panels">
              <Tabs.Trigger className="tab" value="about"><Info size={16} aria-hidden="true" /> About</Tabs.Trigger>
              {hasAnnotations && <Tabs.Trigger className="tab" value="annotations"><MapPin size={16} aria-hidden="true" /> Annotations <span className="pl-count">{annotations.length}</span></Tabs.Trigger>}
              {quizAvailable && <Tabs.Trigger className="tab" value="quiz"><GraduationCap size={16} aria-hidden="true" /> Quiz</Tabs.Trigger>}
              {showStructures && <Tabs.Trigger className="tab" value="structures"><Layers size={16} aria-hidden="true" /> Structures</Tabs.Trigger>}
            </Tabs.List>

            <Tabs.Content value="about" className="pl-tabpanel">
              <div className="pl-about">
                {model.isDemo && <div className="callout callout--warn"><span><strong>Demonstration model.</strong> Simplified shape for software demonstration, not for teaching.</span></div>}
                {model.description.trim() ? <RichText text={model.description} /> : <p className="hint">No description provided.</p>}
                {(regionNames.length > 0 || systemNames.length > 0) && (
                  <dl className="pl-facts">
                    {regionNames.length > 0 && (<><dt>Body region</dt><dd>{regionNames.join(', ')}</dd></>)}
                    {systemNames.length > 0 && (<><dt>Body system</dt><dd>{systemNames.join(', ')}</dd></>)}
                  </dl>
                )}
                <details className="pl-howto">
                  <summary>How to move the model</summary>
                  <ul>
                    <li><strong>Rotate:</strong> drag with the mouse or one finger.</li>
                    <li><strong>Zoom:</strong> scroll wheel, pinch, or the zoom buttons.</li>
                    <li><strong>Pan:</strong> right-drag, two fingers, or Shift + drag.</li>
                    <li><strong>Keyboard:</strong> focus the model, then use the arrow keys to rotate, Shift + arrows to pan, + and − to zoom, 0 to reset.</li>
                  </ul>
                </details>
                {model.credit && <p className="hint pl-credit">Model credit: {model.credit}</p>}
              </div>
            </Tabs.Content>

            {hasAnnotations && (
              <Tabs.Content value="annotations" className="pl-tabpanel pl-tabpanel--ann">
                {f.annotationList && (
                  <div className="pl-ann-scroll">
                    <AnnotationList annotations={annotations} selectedId={selectedId} onSelect={(id) => select(id, true)} states={states} viewed={content.completion === 'launch' ? undefined : viewed} idPrefix="pl-ann" />
                  </div>
                )}
                <div className="pl-ann-detail" ref={detailWrapRef}>
                  {selected ? (
                    <AnnotationDetail
                      annotation={selected}
                      index={selectedIdx}
                      total={annotations.length}
                      concealed={false}
                      state={states[selected.id]}
                      onPrev={annotations.length > 1 ? () => prevNext(-1) : undefined}
                      onNext={annotations.length > 1 ? () => prevNext(1) : undefined}
                      onClose={() => setSelectedId(null)}
                      onFocusOnModel={() => viewerRef.current?.focusAnnotation(selected.id, true)}
                      onShowStructure={() => viewerRef.current?.showAllStructures()}
                    />
                  ) : (
                    <p className="hint pl-ann-prompt">{f.annotationList ? 'Choose an annotation from the list or select a numbered marker on the model.' : 'Select a numbered marker on the model to read about it.'}</p>
                  )}
                </div>
              </Tabs.Content>
            )}

            {quizAvailable && (
              <Tabs.Content value="quiz" className="pl-tabpanel">
                <QuizPanel quiz={quiz} annotations={quizPool} onCentrePick={() => { const a = viewerRef.current?.pickAtCentre(); quiz.pick(a ? { meshKey: a.meshKey, position: a.position } : null); }} onShowOnModel={showOnModel} />
              </Tabs.Content>
            )}

            {showStructures && (
              <Tabs.Content value="structures" className="pl-tabpanel">
                <StructurePanel viewer={viewerRef.current} structure={structure} labels={model.meshLabels} tick={tick} />
              </Tabs.Content>
            )}
          </Tabs.Root>
        </aside>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{state.completed ? 'Package completed.' : ''}</p>
      <p className="hint pl-trackhint">{index >= 0 ? '' : ''}</p>
    </div>
  );
}
