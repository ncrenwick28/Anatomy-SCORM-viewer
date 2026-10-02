import { computeCompletion, emptyProgress, markOpened, markViewed, mergeProgress, type CompletionSummary, type Progress } from '../shared/completion';
import type { PackageContent } from '../shared/content';
import { decodeProgress, encodeProgress, type CodecModel } from '../shared/progressCodec';
import { Scorm12Client, findApi, formatScorm12Time, type Scorm12Api } from './scorm12';

/**
 * Tracks learner progress and reports it to the LMS (SCORM 1.2) when one is present.
 *
 * Modes
 *   lms        – a SCORM 1.2 API was found and a session started: status, location, session time and
 *                a compact suspend_data string are committed to the LMS.
 *   browse     – the LMS opened the SCO in browse/review mode: nothing is written.
 *   standalone – no LMS (or it failed to start): progress is kept in this browser's localStorage only.
 *
 * Health
 *   ok         – the last LMS write succeeded (or there was nothing to write).
 *   degraded   – an LMS call failed; progress continues locally and the tracker keeps retrying.
 */

export type TrackingMode = 'lms' | 'browse' | 'standalone';
export type LinkHealth = 'ok' | 'degraded';

export interface TrackerState {
  mode: TrackingMode;
  health: LinkHealth;
  progress: Progress;
  completion: CompletionSummary;
  /** Completion has been recorded (or was already recorded by the LMS). */
  completed: boolean;
  resumed: boolean;
  lastSavedAt: number | null;
  /** Human-readable explanation when something is not working (never a stack trace). */
  notice: string | null;
  /** Annotation progress from an earlier session was discarded because the package content changed. */
  contentChanged: boolean;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export interface TrackerOptions {
  /** Window used for API discovery. Defaults to the global window. */
  window?: Window;
  /** Override API discovery (tests). Pass null to force standalone mode. */
  api?: Scorm12Api | null;
  /** Where standalone progress lives. null disables persistence (authoring preview). */
  storage?: StorageLike | null;
  now?: () => number;
  /** Debounce before progress is written to the LMS. */
  saveDelayMs?: number;
  /** Retry interval while the LMS link is degraded. */
  retryMs?: number;
}

type Listener = (s: TrackerState) => void;

const ID_LIMIT = 250;

export class ProgressTracker {
  private client: Scorm12Client | null = null;
  private mode: TrackingMode = 'standalone';
  private health: LinkHealth = 'ok';
  private progress: Progress = emptyProgress();
  private completed = false;
  private completionWritten = false;
  /** lesson_status 'incomplete' still has to reach the LMS (retried by save() until it does). */
  private needsIncomplete = false;
  private resumed = false;
  private contentChanged = false;
  private lastSavedAt: number | null = null;
  private notice: string | null = null;
  private startedAt = 0;
  private terminated = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();
  private readonly now: () => number;
  private readonly codecModels: CodecModel[];
  private readonly storageKey: string;

  constructor(private readonly content: Pick<PackageContent, 'packageId' | 'contentHash' | 'completion' | 'models'>, private readonly opts: TrackerOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.codecModels = content.models.map((m) => ({ id: m.id, annotationIds: m.annotations.map((a) => a.id) }));
    this.storageKey = `anatomy-scorm:${content.packageId}`;
  }

  private get storage(): StorageLike | null {
    if (this.opts.storage !== undefined) return this.opts.storage;
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }

  // ───────────── lifecycle ─────────────
  start(): void {
    this.startedAt = this.now();
    const win = this.opts.window ?? (typeof window !== 'undefined' ? window : undefined);
    let api: Scorm12Api | null = null;
    if (this.opts.api !== undefined) api = this.opts.api;
    else if (win) {
      try {
        api = findApi(win as never);
      } catch {
        api = null;
      }
    }
    if (api) this.startLms(api);
    else this.startStandalone(null);
    if (this.content.completion === 'launch') this.markComplete();
    this.recompute();
    this.emit();
    if (this.mode === 'lms') this.scheduleSave(true);
  }

  private startLms(api: Scorm12Api): void {
    const client = new Scorm12Client(api);
    if (!client.init()) {
      const why = client.lastError ? ` (${client.lastError.message || 'error ' + client.lastError.code})` : '';
      this.startStandalone(`The learning management system found by this package did not start a tracking session${why}. Your progress is kept in this browser only.`);
      this.health = 'degraded';
      return;
    }
    this.client = client;
    const lessonMode = (client.get('cmi.core.lesson_mode') ?? 'normal').toLowerCase();
    if (lessonMode === 'browse' || lessonMode === 'review') {
      this.mode = 'browse';
      this.notice = 'This activity was opened in browse mode, so your progress is not being recorded.';
    } else {
      this.mode = 'lms';
    }
    const status = (client.get('cmi.core.lesson_status') ?? '').toLowerCase();
    if (status === 'completed' || status === 'passed') {
      this.completed = true;
      this.completionWritten = true;
    }
    const entry = (client.get('cmi.core.entry') ?? '').toLowerCase();
    const raw = client.get('cmi.suspend_data');
    if (entry === 'resume' || (raw && raw.length)) {
      const decoded = raw ? decodeProgress(raw, this.content.contentHash, this.codecModels) : null;
      if (decoded) {
        this.progress = decoded.progress;
        this.resumed = decoded.progress.opened.length > 0 || Object.keys(decoded.progress.viewed).length > 0;
        this.contentChanged = !decoded.contentMatched;
      }
    }
    if (this.mode === 'lms' && (status === 'not attempted' || status === '' || status === 'browsed')) {
      this.needsIncomplete = !this.completed;
    }
    // If an earlier session of THIS attempt could not reach the LMS, progress was also kept locally; merge it
    // (progress only grows). A brand-new attempt (ab-initio, e.g. after an instructor reset it) starts clean: stale
    // local data must never complete a fresh attempt.
    const resumingAttempt = entry === 'resume' || (status !== '' && status !== 'not attempted');
    const local = resumingAttempt ? this.readLocal() : null;
    if (local && local.matched) {
      const merged = mergeProgress(this.progress, local.progress, this.content.models.map((m) => m.id));
      if (JSON.stringify(merged) !== JSON.stringify(this.progress)) {
        this.progress = merged;
        this.resumed = this.resumed || merged.opened.length > 0;
      }
      if (local.completed && !this.completed) {
        this.completed = true;
        this.completionWritten = false; // make sure the LMS hears about it
      }
    }
  }

  private readLocal(): { progress: Progress; completed: boolean; matched: boolean } | null {
    const st = this.storage;
    if (!st) return null;
    try {
      const raw = st.getItem(this.storageKey);
      if (!raw) return null;
      const saved = JSON.parse(raw) as { data?: string; completed?: boolean };
      const decoded = saved.data ? decodeProgress(saved.data, this.content.contentHash, this.codecModels) : null;
      if (!decoded) return null;
      return { progress: decoded.progress, completed: !!saved.completed && decoded.contentMatched, matched: decoded.contentMatched };
    } catch {
      return null;
    }
  }

  private startStandalone(notice: string | null): void {
    this.mode = 'standalone';
    this.notice = notice;
    const st = this.storage;
    if (!st) return;
    try {
      const raw = st.getItem(this.storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as { data?: string; completed?: boolean };
      const decoded = saved.data ? decodeProgress(saved.data, this.content.contentHash, this.codecModels) : null;
      if (decoded) {
        this.progress = decoded.progress;
        this.resumed = decoded.progress.opened.length > 0;
        this.contentChanged = !decoded.contentMatched;
      }
      if (saved.completed && decoded?.contentMatched) {
        this.completed = true;
        this.completionWritten = true;
      }
    } catch {
      /* corrupt local data is ignored */
    }
  }

  // ───────────── events from the UI ─────────────
  openModel(id: string): void {
    const next = markOpened(this.progress, id);
    if (next === this.progress) return;
    this.progress = next;
    this.afterChange();
  }

  viewAnnotation(modelId: string, annotationId: string): void {
    const next = markViewed(this.progress, modelId, annotationId);
    if (next === this.progress) return;
    this.progress = next;
    this.afterChange();
  }

  private afterChange(): void {
    const wasComplete = this.completed;
    this.recompute();
    this.emit();
    // Completion is committed straight away: it is the one event that must not be lost.
    this.scheduleSave(!wasComplete && this.completed);
  }

  private recompute(): void {
    const summary = computeCompletion(
      this.content.completion,
      this.content.models.map((m) => ({ id: m.id, requiredAnnotationIds: m.annotations.filter((a) => a.required).map((a) => a.id) })),
      this.progress,
    );
    if (summary.complete && !this.completed) this.markComplete();
  }

  private markComplete(): void {
    this.completed = true;
  }

  // ───────────── persistence ─────────────
  private write(name: string, value: string): boolean {
    if (!this.client || this.mode !== 'lms') return true;
    const ok = this.client.set(name, value);
    if (!ok) this.noteFailure();
    return ok;
  }

  private noteFailure(): void {
    const e = this.client?.lastError;
    this.health = 'degraded';
    this.notice = `The learning management system could not save your progress${e ? ` (${e.message || 'error ' + e.code})` : ''}. Your progress is kept in this browser and the package will keep trying.`;
    if (!this.retryTimer && !this.terminated) {
      this.retryTimer = setInterval(() => this.save(), this.opts.retryMs ?? 15000);
    }
  }

  private noteSuccess(): void {
    if (this.health === 'degraded') {
      this.health = 'ok';
      this.notice = null;
    }
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private scheduleSave(immediate = false): void {
    if (this.terminated) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (immediate) {
      this.saveTimer = null;
      this.save();
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, this.opts.saveDelayMs ?? 800);
  }

  /** Writes current progress to the LMS (and to local storage as a safety net). */
  save(): void {
    this.saveLocal();
    if (!this.client || this.mode !== 'lms' || this.client.finished) {
      this.emit();
      return;
    }
    let ok = true;
    if (this.needsIncomplete && !this.completed) {
      if (this.write('cmi.core.lesson_status', 'incomplete')) this.needsIncomplete = false;
      else ok = false;
    }
    ok = this.write('cmi.suspend_data', encodeProgress(this.content.contentHash, this.codecModels, this.progress)) && ok;
    if (this.progress.lastModelId) ok = this.write('cmi.core.lesson_location', this.progress.lastModelId.slice(0, ID_LIMIT)) && ok;
    ok = this.write('cmi.core.session_time', formatScorm12Time(this.now() - this.startedAt)) && ok;
    if (this.completed && !this.completionWritten) {
      if (this.write('cmi.core.lesson_status', 'completed')) this.completionWritten = true;
      else ok = false;
    }
    if (ok && this.client.commit()) {
      this.lastSavedAt = this.now();
      this.noteSuccess();
    } else {
      if (ok) this.noteFailure();
    }
    this.emit();
  }

  private saveLocal(): void {
    const st = this.storage;
    if (!st) return;
    try {
      st.setItem(this.storageKey, JSON.stringify({ v: 1, data: encodeProgress(this.content.contentHash, this.codecModels, this.progress), completed: this.completed }));
      if (this.mode === 'standalone') this.lastSavedAt = this.now();
    } catch {
      /* storage may be unavailable (private mode); progress still works for this visit */
    }
  }

  /** Ends the SCORM session. Safe to call repeatedly (pagehide, beforeunload and unload may all fire). */
  terminate(): void {
    if (this.terminated) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.saveTimer = this.retryTimer = null;
    this.save();
    this.terminated = true;
    const c = this.client;
    if (c && this.mode === 'lms' && !c.finished) {
      if (!this.completed) c.set('cmi.core.exit', 'suspend');
      c.set('cmi.core.session_time', formatScorm12Time(this.now() - this.startedAt));
      c.commit();
      c.finish();
    } else if (c && !c.finished) {
      c.finish();
    }
  }

  // ───────────── observation ─────────────
  getState(): TrackerState {
    return {
      mode: this.mode,
      health: this.health,
      progress: this.progress,
      completion: computeCompletion(
        this.content.completion,
        this.content.models.map((m) => ({ id: m.id, requiredAnnotationIds: m.annotations.filter((a) => a.required).map((a) => a.id) })),
        this.progress,
      ),
      completed: this.completed,
      resumed: this.resumed,
      lastSavedAt: this.lastSavedAt,
      notice: this.notice,
      contentChanged: this.contentChanged,
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const s = this.getState();
    this.listeners.forEach((l) => l(s));
  }
}
