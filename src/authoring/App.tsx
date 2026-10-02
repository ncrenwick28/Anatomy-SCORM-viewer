import { useEffect, useState } from 'react';
import { BookOpen, HelpCircle, Library as LibraryIcon, Package } from 'lucide-react';
import { ConfirmProvider } from './components/Modal';
import { BackupMenu } from './components/BackupMenu';
import { SaveStatus } from './components/SaveStatus';
import { Toasts } from './components/Toasts';
import { ExportPage } from './pages/ExportPage';
import { HelpPage } from './pages/Help';
import { LibraryPage } from './pages/Library';
import { WorkspacePage } from './pages/Workspace';
import { hasUnsavedWork, useStudio } from './state/store';

type Route = { name: 'library' } | { name: 'model'; id: string } | { name: 'export' } | { name: 'help' };

function parse(): Route {
  const h = location.hash;
  const m = /^#\/model\/(.+)$/.exec(h);
  if (m) return { name: 'model', id: decodeURIComponent(m[1]) };
  if (h === '#/export') return { name: 'export' };
  if (h === '#/help') return { name: 'help' };
  return { name: 'library' };
}

export function go(path: string) {
  location.hash = path;
}

export function App() {
  const status = useStudio((s) => s.status);
  const error = useStudio((s) => s.error);
  const init = useStudio((s) => s.init);
  const selectedCount = useStudio((s) => s.project.exportConfig.selectedModelIds.length);
  const saveState = useStudio((s) => s.save.state);
  const stale = useStudio((s) => s.staleElsewhere);
  const resolveConflict = useStudio((s) => s.resolveConflict);
  const reload = useStudio((s) => s.reload);
  const [route, setRoute] = useState<Route>(parse);

  useEffect(() => void init(), [init]);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (hasUnsavedWork()) {
        void useStudio.getState().flush();
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const keys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void useStudio.getState().flush();
      }
    };
    window.addEventListener('beforeunload', before);
    window.addEventListener('keydown', keys);
    return () => {
      window.removeEventListener('beforeunload', before);
      window.removeEventListener('keydown', keys);
    };
  }, []);
  useEffect(() => {
    const titles = { library: 'Library', model: 'Model', export: 'Export', help: 'Help' } as const;
    document.title = `${titles[route.name]} · Anatomy SCORM Studio`;
  }, [route]);

  if (status === 'loading') return <div className="boot-message" role="status">Opening your project…</div>;
  if (status === 'error') {
    return (
      <div className="fatal">
        <h1>Your work cannot be saved in this browser</h1>
        <p>{error}</p>
        <p className="hint">Anatomy SCORM Studio stores your project in the browser’s IndexedDB. Private browsing or blocked site data prevents that. Open it in a normal window and allow site data for this address.</p>
        <button type="button" className="btn btn--primary" onClick={() => location.reload()}>Try again</button>
      </div>
    );
  }

  const nav = (name: Route['name'], href: string, label: string, icon: React.ReactNode, badge?: number) => (
    <a href={href} className="nav-link" aria-current={route.name === name || (name === 'library' && route.name === 'model') ? 'page' : undefined}>
      {icon}<span>{label}</span>{badge ? <span className="nav-badge">{badge}</span> : null}
    </a>
  );

  return (
    <ConfirmProvider>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="app-header">
        <a className="app-brand" href="#/" aria-label="Anatomy SCORM Studio, home">
          <span className="app-brand__mark" aria-hidden="true"><BookOpen size={18} /></span>
          <span>Anatomy SCORM Studio</span>
        </a>
        <nav className="app-nav" aria-label="Main">
          {nav('library', '#/', 'Library', <LibraryIcon size={17} aria-hidden="true" />)}
          {nav('export', '#/export', 'Export', <Package size={17} aria-hidden="true" />, selectedCount)}
          {nav('help', '#/help', 'Help', <HelpCircle size={17} aria-hidden="true" />)}
        </nav>
        <div className="app-header__right">
          <SaveStatus />
          <BackupMenu />
        </div>
      </header>
      {saveState === 'conflict' ? (
        <div className="callout callout--error app-banner" role="alert" data-testid="conflict-banner">
          <div>
            <strong>This project was changed in another browser tab or window.</strong> To protect that work, this tab has stopped saving, and what you see here may be out of date.
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn--sm btn--primary" onClick={() => void resolveConflict('reload')} data-testid="conflict-reload">Load the latest version (discard changes made in this tab)</button>
              <button type="button" className="btn btn--sm" onClick={() => void resolveConflict('overwrite')} data-testid="conflict-overwrite">Overwrite with this tab’s version</button>
            </div>
          </div>
        </div>
      ) : stale ? (
        <div className="callout callout--warn app-banner" role="status" data-testid="stale-banner">
          <div>
            <strong>This project was updated in another tab.</strong> Reload to see the latest changes before editing here.
            <div className="btn-row" style={{ marginTop: 8 }}><button type="button" className="btn btn--sm" onClick={() => void reload()}>Reload the latest version</button></div>
          </div>
        </div>
      ) : null}
      <main id="main" className={`app-main ${route.name === 'model' ? 'app-main--wide' : ''}`}>
        {route.name === 'library' && <LibraryPage onOpenModel={(id) => go(`#/model/${encodeURIComponent(id)}`)} onGoExport={() => go('#/export')} />}
        {route.name === 'model' && <WorkspacePage key={route.id} modelId={route.id} onBack={() => go('#/')} onGoExport={() => go('#/export')} />}
        {route.name === 'export' && <ExportPage onGoLibrary={() => go('#/')} />}
        {route.name === 'help' && <HelpPage />}
      </main>
      <Toasts />
    </ConfirmProvider>
  );
}
