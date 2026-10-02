import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ViewerCore } from '../viewer/ViewerCore';
import { App } from './App';
import { useStudio } from './state/store';
import '../ui/base.css';
import '../ui/panels.css';
import './authoring.css';

// Read-only diagnostics used by automated tests and support.
(window as unknown as Record<string, unknown>).__ANATOMY_DEBUG__ = {
  studio: () => useStudio.getState(),
  viewers: () => [...ViewerCore.instances].map((v) => v.debugState()),
  primary: () => [...ViewerCore.instances][0],
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
