import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { PackageContent } from '../shared/content';
import { themeStyle } from '../shared/color';
import { AssetImage, AssetResolverContext, type AssetResolver } from '../ui/Assets';
import { Gallery } from './Gallery';
import { ModelView } from './ModelView';
import { ProgressSummary, TrackingStatus } from './StatusBar';
import type { ProgressTracker } from './tracker';
import { useTracker } from './useTracker';
import '../ui/base.css';
import '../ui/panels.css';
import './player.css';

export interface PlayerProps {
  content: PackageContent;
  tracker: ProgressTracker;
  resolveAsset?: AssetResolver;
  dracoPath?: string;
  /** Authoring preview: shows a banner and keeps routing in component state instead of the URL hash. */
  preview?: { onExit: () => void; label?: string } | null;
  initialModelId?: string | null;
}

type Route = { view: 'gallery' } | { view: 'model'; id: string };

function parseHash(content: PackageContent): Route {
  const m = /^#\/model\/(.+)$/.exec(location.hash);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (content.models.some((x) => x.id === id)) return { view: 'model', id };
  }
  return { view: 'gallery' };
}

export function Player({ content, tracker, resolveAsset, dracoPath = 'lib/draco/', preview, initialModelId }: PlayerProps) {
  const state = useTracker(tracker);
  const useHash = !preview;
  const [route, setRoute] = useState<Route>(() => (initialModelId ? { view: 'model', id: initialModelId } : useHash ? parseHash(content) : { view: 'gallery' }));
  const [lastOpened, setLastOpened] = useState<string | null>(null);
  const resolver = useMemo<AssetResolver>(() => resolveAsset ?? ((p) => p), [resolveAsset]);

  useEffect(() => {
    if (!useHash) return;
    const on = () => setRoute(parseHash(content));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [content, useHash]);

  const go = useCallback(
    (r: Route) => {
      if (r.view === 'gallery' && route.view === 'model') setLastOpened(route.id);
      setRoute(r);
      if (useHash) {
        const target = r.view === 'model' ? `#/model/${encodeURIComponent(r.id)}` : '#/';
        if (location.hash !== target) location.hash = target;
      }
      window.scrollTo?.({ top: 0 });
    },
    [route, useHash],
  );

  const model = route.view === 'model' ? content.models.find((m) => m.id === route.id) : null;
  const style = useMemo(() => themeStyle(content.accent) as React.CSSProperties, [content.accent]);

  useEffect(() => {
    if (route.view === 'gallery') document.title = content.title;
  }, [route.view, content.title]);

  return (
    <AssetResolverContext.Provider value={resolver}>
      <div className="pl-app" style={style} data-testid="player" data-route={route.view}>
        <a className="skip-link" href="#pl-main">Skip to content</a>
        {preview && (
          <div className="pl-preview-bar" role="region" aria-label="Preview">
            <strong>{preview.label ?? 'Student preview'}</strong>
            <span>This is how students will see the package. Authoring controls are not included. Progress is not recorded.</span>
            <button type="button" className="btn btn--sm" onClick={preview.onExit}><X /> Exit preview</button>
          </div>
        )}
        <header className="pl-header">
          <div className="pl-brand">
            {content.logo && <AssetImage path={content.logo} alt="" className="pl-logo" />}
            <span className="pl-brand__name">{content.title}</span>
          </div>
          <ProgressSummary content={content} state={state} />
        </header>
        {state.notice && !preview && (
          <div className="callout callout--warn pl-notice" role="alert"><span>{state.notice}</span></div>
        )}
        <main id="pl-main" className="pl-main">
          {route.view === 'gallery' || !model ? (
            <Gallery content={content} state={state} restoreFocusId={lastOpened} onOpen={(id) => go({ view: 'model', id })} />
          ) : (
            <ModelView
              key={model.id}
              content={content}
              model={model}
              index={content.models.indexOf(model)}
              state={state}
              tracker={tracker}
              dracoPath={dracoPath}
              onBack={() => go({ view: 'gallery' })}
              onNavigate={(id) => go({ view: 'model', id })}
            />
          )}
        </main>
        <footer className="pl-footer">
          <TrackingStatus state={state} preview={!!preview} />
          <span className="hint">{content.generator.name} {content.generator.version}</span>
        </footer>
      </div>
    </AssetResolverContext.Provider>
  );
}
