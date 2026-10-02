import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CONTENT_GLOBAL, type PackageContent } from '../shared/content';
import { ViewerCore } from '../viewer/ViewerCore';
import { Player } from './Player';
import { ProgressTracker } from './tracker';

function fatal(root: HTMLElement, message: string) {
  root.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'boot-message';
  p.setAttribute('role', 'alert');
  p.textContent = message;
  root.appendChild(p);
}

function boot() {
  const root = document.getElementById('root');
  if (!root) return;
  const content = (window as unknown as Record<string, PackageContent | undefined>)[CONTENT_GLOBAL];
  if (!content || !Array.isArray(content.models) || content.schema !== 1) {
    fatal(root, 'This learning package is incomplete: its content file could not be read. Please re-upload the package to your LMS.');
    return;
  }
  const tracker = new ProgressTracker(content);
  tracker.start();
  const end = () => tracker.terminate();
  window.addEventListener('pagehide', end);
  window.addEventListener('beforeunload', end);
  window.addEventListener('unload', end);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') tracker.save();
  });
  // Read-only diagnostics used by automated tests and support.
  (window as unknown as Record<string, unknown>).__ANATOMY_DEBUG__ = {
    tracker,
    viewers: () => [...ViewerCore.instances].map((v) => v.debugState()),
    primary: () => [...ViewerCore.instances][0],
  };
  document.title = content.title;
  createRoot(root).render(
    <StrictMode>
      <Player content={content} tracker={tracker} />
    </StrictMode>,
  );
}

boot();
