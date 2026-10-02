import { useCallback, useEffect, useRef, useState, type ReactNode, type MutableRefObject } from 'react';
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Maximize2, Minimize2, Move, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import type { Annotation, BackgroundSetting, LightingSettings, ViewSettings } from '../shared/types';
import { ViewerCore } from '../viewer/ViewerCore';
import { ModelLoadError } from '../viewer/loader';
import type { LoadProgress, LoadedModelInfo, MarkerState, ModelSource, PickResult } from '../viewer/types';
import '../viewer/viewer.css';

export interface ViewportProps {
  source: ModelSource | null;
  /** Used to key a (re)load, e.g. the model id + file ids. */
  sourceKey: string;
  annotations: Annotation[];
  selectedId: string | null;
  showMarkers: boolean;
  showHiddenMarkers: boolean;
  view: ViewSettings;
  /** When true, `view.camera` is applied after load (default framing otherwise). */
  applySavedView?: boolean;
  labelFor?: (a: Annotation, index: number) => string;
  pickMode?: boolean;
  dracoPath?: string;
  viewerRef?: MutableRefObject<ViewerCore | null>;
  onLoaded?: (info: LoadedModelInfo, viewer: ViewerCore) => void;
  onMarkerClick?: (id: string) => void;
  onPick?: (r: PickResult | null) => void;
  onBackgroundClick?: () => void;
  onMarkerStates?: (s: Record<string, MarkerState>) => void;
  onVisibility?: () => void;
  onCameraMoved?: () => void;
  fullscreen?: { active: boolean; toggle: () => void } | null;
  overlay?: ReactNode;
  className?: string;
  ariaLabel?: string;
}

type LoadState = { status: 'loading'; progress: LoadProgress } | { status: 'ready' } | { status: 'error'; message: string };

const stageText: Record<string, string> = {
  downloading: 'Loading model',
  parsing: 'Reading model',
  preparing: 'Preparing model for interaction',
  ready: 'Ready',
};

/** React wrapper around ViewerCore with loading and error states and keyboard-accessible view controls. */
export function Viewport(props: ViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ViewerCore | null>(null);
  const [load, setLoad] = useState<LoadState>({ status: 'loading', progress: { stage: 'downloading', fraction: null } });
  const [retry, setRetry] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const latest = useRef(props);
  latest.current = props;

  // Create / dispose the viewer.
  useEffect(() => {
    const host = hostRef.current!;
    let viewer: ViewerCore;
    try {
      viewer = new ViewerCore(host, {
        dracoPath: props.dracoPath,
        labelFor: (a, i) => latest.current.labelFor?.(a, i) ?? a.label,
      });
    } catch (err) {
      setLoad({ status: 'error', message: 'This browser could not start 3D graphics (WebGL). Try another browser, enable hardware acceleration, or update your graphics drivers.' });
      console.error(err);
      return;
    }
    viewerRef.current = viewer;
    if (props.viewerRef) props.viewerRef.current = viewer;
    const offs = [
      viewer.on('markerClick', ({ id }) => latest.current.onMarkerClick?.(id)),
      viewer.on('pick', (r) => latest.current.onPick?.(r)),
      viewer.on('backgroundClick', () => latest.current.onBackgroundClick?.()),
      viewer.on('markerStates', (s) => latest.current.onMarkerStates?.(s)),
      viewer.on('visibility', () => latest.current.onVisibility?.()),
      viewer.on('cameraMoved', () => latest.current.onCameraMoved?.()),
      viewer.on('contextLost', () => setContextLost(true)),
    ];
    return () => {
      offs.forEach((o) => o());
      viewer.dispose();
      viewerRef.current = null;
      if (props.viewerRef) props.viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the model whenever the source changes.
  useEffect(() => {
    const viewer = viewerRef.current;
    const src = props.source;
    if (!viewer || !src) return;
    const ctrl = new AbortController();
    setLoad({ status: 'loading', progress: { stage: 'downloading', fraction: null } });
    viewer
      .loadModel(src, { signal: ctrl.signal, onProgress: (p) => !ctrl.signal.aborted && setLoad({ status: 'loading', progress: p }) })
      .then((info) => {
        if (ctrl.signal.aborted) return;
        const p = latest.current;
        viewer.setBackground(p.view.background);
        viewer.setLighting(p.view.lighting);
        viewer.setDefaultView(p.view.camera);
        viewer.setHiddenKeys(p.view.hiddenMeshKeys);
        viewer.setAnnotations(p.annotations);
        viewer.setSelected(p.selectedId);
        viewer.setMarkersVisible(p.showMarkers);
        viewer.setShowHiddenMarkers(p.showHiddenMarkers);
        viewer.setPickMode(!!p.pickMode);
        if (p.applySavedView !== false) viewer.resetView(false);
        setLoad({ status: 'ready' });
        p.onLoaded?.(info, viewer);
      })
      .catch((err) => {
        if (ctrl.signal.aborted || (err as { name?: string })?.name === 'AbortError') return;
        setLoad({ status: 'error', message: err instanceof ModelLoadError ? err.message : `The model could not be shown: ${(err as Error).message}` });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sourceKey, props.source, retry]);

  // Keep the viewer in step with props.
  useEffect(() => void viewerRef.current?.setAnnotations(props.annotations), [props.annotations]);
  useEffect(() => void viewerRef.current?.setSelected(props.selectedId), [props.selectedId]);
  useEffect(() => void viewerRef.current?.setMarkersVisible(props.showMarkers), [props.showMarkers]);
  useEffect(() => void viewerRef.current?.setShowHiddenMarkers(props.showHiddenMarkers), [props.showHiddenMarkers]);
  useEffect(() => void viewerRef.current?.setPickMode(!!props.pickMode), [props.pickMode]);
  useEffect(() => void viewerRef.current?.setBackground(props.view.background as BackgroundSetting), [props.view.background]);
  useEffect(() => void viewerRef.current?.setLighting(props.view.lighting as LightingSettings), [props.view.lighting]);
  useEffect(() => void viewerRef.current?.setDefaultView(props.view.camera), [props.view.camera]);
  useEffect(() => void viewerRef.current?.refreshMarkers(), [props.labelFor]);

  const v = () => viewerRef.current;
  const step = 15;
  const rot = (a: number, p: number) => (panMode ? v()?.panBy(a / 100, p / 100) : v()?.rotateBy(a, p));
  const ready = load.status === 'ready';

  return (
    <div className={`vp ${props.className ?? ''}`} role="region" aria-label={props.ariaLabel ?? '3D model'}>
      <div ref={hostRef} className="vp__host" />
      {load.status === 'loading' && (
        <div className="av-loading" role="status" aria-live="polite">
          <strong>{stageText[load.progress.stage]}…</strong>
          <div className={`av-loading__bar ${load.progress.fraction === null ? 'av-loading__bar--indeterminate' : ''}`} aria-hidden="true">
            <i style={load.progress.fraction === null ? undefined : { width: `${Math.round(load.progress.fraction * 100)}%` }} />
          </div>
        </div>
      )}
      {load.status === 'error' && (
        <div className="av-loading av-error" role="alert">
          <AlertTriangle size={32} aria-hidden="true" />
          <strong>The model could not be shown</strong>
          <span style={{ maxWidth: 460 }}>{load.message}</span>
          <button className="btn btn--primary" type="button" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {contextLost && (
        <div className="av-loading av-error" role="alert">
          <AlertTriangle size={32} aria-hidden="true" />
          <strong>3D graphics were interrupted</strong>
          <span>The browser released the graphics resources, which can happen when the device is low on memory.</span>
          <button className="btn btn--primary" type="button" onClick={() => location.reload()}>Reload</button>
        </div>
      )}
      {ready && (
        <div className="vp__controls" role="toolbar" aria-label="View controls">
          <div className="vp__group">
            <button type="button" className="btn btn--icon btn--sm" aria-label={panMode ? 'Pan left' : 'Rotate left'} title={panMode ? 'Pan left' : 'Rotate left'} onClick={() => rot(-step, 0)}><ArrowLeft /></button>
            <button type="button" className="btn btn--icon btn--sm" aria-label={panMode ? 'Pan right' : 'Rotate right'} title={panMode ? 'Pan right' : 'Rotate right'} onClick={() => rot(step, 0)}><ArrowRight /></button>
            <button type="button" className="btn btn--icon btn--sm" aria-label={panMode ? 'Pan up' : 'Rotate up'} title={panMode ? 'Pan up' : 'Rotate up'} onClick={() => rot(0, step)}><ArrowUp /></button>
            <button type="button" className="btn btn--icon btn--sm" aria-label={panMode ? 'Pan down' : 'Rotate down'} title={panMode ? 'Pan down' : 'Rotate down'} onClick={() => rot(0, -step)}><ArrowDown /></button>
            <button type="button" className="btn btn--icon btn--sm" aria-pressed={panMode} aria-label="Arrow buttons pan instead of rotate" title="Switch the arrow buttons between rotate and pan" onClick={() => setPanMode((p) => !p)}><Move /></button>
          </div>
          <div className="vp__group">
            <button type="button" className="btn btn--icon btn--sm" aria-label="Zoom in" title="Zoom in" onClick={() => v()?.zoomBy(0.8)}><ZoomIn /></button>
            <button type="button" className="btn btn--icon btn--sm" aria-label="Zoom out" title="Zoom out" onClick={() => v()?.zoomBy(1.25)}><ZoomOut /></button>
          </div>
          <div className="vp__group">
            <button type="button" className="btn btn--sm" onClick={() => v()?.resetView(true)} title="Return to the default view (0)"><RotateCcw /> Reset view</button>
            {props.fullscreen && (
              <button type="button" className="btn btn--icon btn--sm" aria-label={props.fullscreen.active ? 'Exit full screen' : 'Full screen'} title={props.fullscreen.active ? 'Exit full screen' : 'Full screen'} onClick={props.fullscreen.toggle}>
                {props.fullscreen.active ? <Minimize2 /> : <Maximize2 />}
              </button>
            )}
          </div>
        </div>
      )}
      {props.overlay}
    </div>
  );
}

export function useViewerRef() {
  return useRef<ViewerCore | null>(null);
}

export function useVisibilityTick() {
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  return [tick, bump] as const;
}
