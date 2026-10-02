import { AlertTriangle, Check, Loader2, PencilLine } from 'lucide-react';
import { useStudio } from '../state/store';

/** Persistent save indicator. Edits are written to the browser's IndexedDB automatically. */
export function SaveStatus() {
  const save = useStudio((s) => s.save);
  const flush = useStudio((s) => s.flush);
  let icon = <Check aria-hidden="true" />;
  let text = 'All changes saved';
  let cls = 'ok';
  if (save.state === 'saving') (icon = <Loader2 className="spin-icon" aria-hidden="true" />), (text = 'Saving…'), (cls = 'busy');
  else if (save.state === 'dirty') (icon = <PencilLine aria-hidden="true" />), (text = 'Unsaved changes'), (cls = 'dirty');
  else if (save.state === 'error') (icon = <AlertTriangle aria-hidden="true" />), (text = 'Save failed'), (cls = 'error');
  const time = save.lastSavedAt ? new Date(save.lastSavedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <div className={`save-status save-status--${cls}`} role="status" aria-live="polite" data-testid="save-status" data-state={save.state}>
      {icon}
      <span>{text}{save.state === 'saved' && time ? ` · ${time}` : ''}</span>
      {save.state === 'error' && (
        <button type="button" className="btn btn--sm" onClick={() => void flush()} title={save.error ?? undefined}>Retry</button>
      )}
      {save.state === 'dirty' && (
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => void flush()} title="Save now (Ctrl+S)">Save now</button>
      )}
    </div>
  );
}
