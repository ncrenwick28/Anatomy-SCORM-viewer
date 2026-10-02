import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, Eye, EyeOff, MapPin, Info, Layers, GraduationCap } from 'lucide-react';
import type { PackageContent, PackageModel } from '../shared/content';
import type { Annotation } from '../shared/types';
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
  const [selfStudy, setSelfStudy] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState('about');
  const annotations = model.annotations;
  const hasAnnotations = annotations.length > 0;
  const viewed = useMemo(() => new Set(state.progress.viewed[model.id] ?? []), [state.progress.viewed, model.id]);

  // Reset per-model state when switching models.
  useEffect(() => {
    setSelectedId(null);
    setRevealed(new Set());
    setSelfStudy(false);
    setShowHidden(false);
    setShowMarkers(true);
    setStructure([]);
    setStates({});
    setTab('about');
    headingRef.current?.focus();
    document.title = `${model.title} – ${content.title}`;
    return () => void (document.title = content.title);
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

  const isConcealed = useCallback((a: Annotation) => selfStudy && !revealed.has(a.id), [selfStudy, revealed]);
  const labelFor = useCallback((a: Annotation, i: number) => (isConcealed(a) ? `Structure ${i + 1}` : a.label), [isConcealed]);

  // An annotation counts as "viewed" only once its label and description are actually on screen: the detail
  // card lives in the Annotations tab, so that tab must be showing (and the name must not be concealed).
  useEffect(() => {
    if (!selectedId || tab !== 'annotations') return;
    const a = annotations.find((x) => x.id === selectedId);
    if (a && !isConcealed(a)) tracker.viewAnnotation(model.id, a.id);
  }, [selectedId, tab, isConcealed, annotations, tracker, model.id]);

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
      {hasAnnotations && (
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
          annotations={annotations}
          selectedId={selectedId}
          showMarkers={showMarkers}
          showHiddenMarkers={showHidden}
          view={model.view}
          labelFor={labelFor}
          dracoPath={dracoPath}
          viewerRef={viewerRef}
          fullscreen={f.fullscreen ? fullscreen : null}
          overlay={overlay}
          onLoaded={(info) => {
            setStructure(info.structure);
            tracker.openModel(model.id);
          }}
          onMarkerClick={(id) => select(id)}
          onBackgroundClick={() => undefined}
          onMarkerStates={setStates}
          onVisibility={() => setTick((t) => t + 1)}
        />
        <aside className="pl-panel" aria-label="Model information">
          <Tabs.Root value={tab} onValueChange={setTab} className="pl-tabs">
            <Tabs.List className="tabs-list" aria-label="Model panels">
              <Tabs.Trigger className="tab" value="about"><Info size={16} aria-hidden="true" /> About</Tabs.Trigger>
              {hasAnnotations && <Tabs.Trigger className="tab" value="annotations"><MapPin size={16} aria-hidden="true" /> Annotations <span className="pl-count">{annotations.length}</span></Tabs.Trigger>}
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
                <div className="pl-ann-tools">
                  {f.selfStudy && f.annotationList && (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={selfStudy}
                      className={`pl-switch ${selfStudy ? 'is-on' : ''}`}
                      onClick={() => { setSelfStudy((s) => !s); setRevealed(new Set()); }}
                    >
                      <span className="pl-switch__track" aria-hidden="true"><i /></span>
                      <GraduationCap size={16} aria-hidden="true" /> Self-study mode
                    </button>
                  )}
                  {selfStudy && (
                    <div className="pl-reveal-all">
                      <button type="button" className="btn btn--sm" onClick={() => setRevealed(new Set(annotations.map((a) => a.id)))}>Reveal all</button>
                      <button type="button" className="btn btn--sm" onClick={() => setRevealed(new Set())}>Hide all</button>
                    </div>
                  )}
                </div>
                {selfStudy && <p className="hint pl-ann-hint">Names are hidden. Pick a marker, think, then reveal.</p>}
                {f.annotationList && (
                  <div className="pl-ann-scroll">
                    <AnnotationList annotations={annotations} selectedId={selectedId} onSelect={(id) => select(id, true)} states={states} viewed={content.completion === 'launch' ? undefined : viewed} isConcealed={isConcealed} idPrefix="pl-ann" />
                  </div>
                )}
                <div className="pl-ann-detail" ref={detailWrapRef}>
                  {selected ? (
                    <AnnotationDetail
                      annotation={selected}
                      index={selectedIdx}
                      total={annotations.length}
                      concealed={isConcealed(selected)}
                      onReveal={() => setRevealed((r) => new Set(r).add(selected.id))}
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
