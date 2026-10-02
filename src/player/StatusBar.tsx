import { AlertTriangle, CheckCircle2, CloudCheck, HardDrive, Info } from 'lucide-react';
import type { PackageContent } from '../shared/content';
import type { TrackerState } from './tracker';

/** Honest progress and tracking status. It only claims LMS tracking when an LMS session is actually running. */
export function ProgressSummary({ content, state }: { content: PackageContent; state: TrackerState }) {
  const c = state.completion;
  const rule = content.completion;
  const pct = Math.round(c.fraction * 100);
  if (rule === 'launch') return null;
  return (
    <div className="pl-progress" aria-label="Your progress">
      <div className="pl-progress__text">
        <strong>{c.modelsOpened} of {c.modelsTotal}</strong> models opened
        {rule === 'open-all-and-annotations' && c.annotationsRequired > 0 && (
          <>
            {' · '}
            <strong>{c.annotationsViewed} of {c.annotationsRequired}</strong> annotations viewed
          </>
        )}
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.completed ? 100 : pct} aria-label="Completion progress">
        <i style={{ width: `${state.completed ? 100 : pct}%` }} />
      </div>
      {state.completed && (
        <span className="chip chip--ok" role="status"><CheckCircle2 aria-hidden="true" /> Completed</span>
      )}
    </div>
  );
}

export function TrackingStatus({ state, preview }: { state: TrackerState; preview?: boolean }) {
  let icon = <HardDrive aria-hidden="true" />;
  let text: string;
  let tone = '';
  if (preview) {
    icon = <Info aria-hidden="true" />;
    text = 'Preview: progress is not recorded anywhere';
  } else if (state.mode === 'lms' && state.health === 'ok') {
    icon = <CloudCheck aria-hidden="true" />;
    text = state.lastSavedAt ? `Progress saved to your course at ${new Date(state.lastSavedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Progress is recorded in your course';
    tone = 'ok';
  } else if (state.health === 'degraded') {
    icon = <AlertTriangle aria-hidden="true" />;
    text = state.mode === 'lms' ? 'Course not reachable: progress kept in this browser, retrying' : 'Course tracking unavailable: progress kept in this browser';
    tone = 'warn';
  } else if (state.mode === 'browse') {
    icon = <Info aria-hidden="true" />;
    text = 'Browse mode: progress is not recorded';
  } else {
    text = 'Standalone mode: progress is saved in this browser only, not sent to an LMS';
  }
  return (
    <div className={`pl-status ${tone ? `pl-status--${tone}` : ''}`} role="status" aria-live="polite" data-testid="tracking-status" data-mode={preview ? 'preview' : state.mode} data-health={state.health}>
      {icon}
      <span>{text}</span>
    </div>
  );
}
