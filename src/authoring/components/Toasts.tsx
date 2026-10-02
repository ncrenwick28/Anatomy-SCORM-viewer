import { X } from 'lucide-react';
import { useToasts } from '../state/toasts';

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'toast--error' : t.kind === 'ok' ? 'toast--ok' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span>{t.message}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}><X size={16} /></button>
        </div>
      ))}
    </div>
  );
}
