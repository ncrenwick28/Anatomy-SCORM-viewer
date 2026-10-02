import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scorm12API } from 'scorm-again/scorm12';
import { ProgressTracker } from '../../src/player/tracker';
import { findApi, formatScorm12Time, Scorm12Client, type Scorm12Api } from '../../src/player/scorm12';
import type { PackageContent } from '../../src/shared/content';
import type { CompletionRule } from '../../src/shared/types';
import { sampleModel } from '../fixtures/makeModels';

function content(rule: CompletionRule): Pick<PackageContent, 'packageId' | 'contentHash' | 'completion' | 'models'> {
  const mk = (id: string, anns: string[]) => ({ ...sampleModel({ id }), annotations: anns.map((a) => ({ ...sampleModel().annotations[0], id: a })) });
  return {
    packageId: 'pkg-test',
    contentHash: 'h1',
    completion: rule,
    models: [mk('m1', ['a1', 'a2']), mk('m2', ['b1'])].map((m) => ({ id: m.id, annotations: m.annotations })) as never,
  };
}

/** scorm-again is an independent SCORM 1.2 implementation that validates data-model values. */
function lms(initial: Record<string, string> = {}) {
  const api = new Scorm12API({ logLevel: 5, autocommit: false } as never);
  api.loadFromJSON?.({ cmi: { core: { ...initial } } } as never, '');
  return api;
}
type Recorded = Scorm12API & Scorm12Api & { writes: Record<string, string>; rejected: string[] };
/** Wraps SetValue so tests can see write-only elements (session_time, exit) and any value the LMS rejected. */
const asApi = (a: unknown): Recorded => {
  const api = a as Recorded;
  api.writes = {};
  api.rejected = [];
  const orig = api.LMSSetValue.bind(api);
  api.LMSSetValue = (n: string, v: string) => {
    const r = orig(n, v);
    if (String(r) === 'true') api.writes[n] = v;
    else api.rejected.push(`${n}=${v}`);
    return r;
  };
  return api;
};
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SCORM 1.2 discovery and client', () => {
  it('finds API in parent and opener frames and ignores cross-origin frames', () => {
    const api = lms();
    const top = { API: api, parent: null as unknown };
    const frame = { parent: top, API: undefined };
    expect(findApi(frame as never)).toBe(api);
    const crossOrigin = {
      get API(): unknown {
        throw new DOMException('blocked', 'SecurityError');
      },
      parent: top,
    };
    expect(findApi(crossOrigin as never)).toBe(api);
    const popup = { parent: null, opener: top };
    expect(findApi(popup as never)).toBe(api);
    expect(findApi({ parent: null } as never)).toBeNull();
  });
  it('formats SCORM 1.2 session time (HHHH:MM:SS.SS)', () => {
    expect(formatScorm12Time(0)).toBe('0000:00:00.00');
    expect(formatScorm12Time(61_230)).toBe('0000:01:01.23');
    expect(formatScorm12Time(3_723_450)).toBe('0001:02:03.45');
    expect(formatScorm12Time(-5)).toBe('0000:00:00.00');
  });
  it('survives an API that throws', () => {
    const bad = { LMSInitialize: () => { throw new Error('boom'); }, LMSFinish: () => 'true', LMSGetValue: () => '', LMSSetValue: () => 'true', LMSCommit: () => 'true', LMSGetLastError: () => '0', LMSGetErrorString: () => '', LMSGetDiagnostic: () => '' };
    const c = new Scorm12Client(bad as Scorm12Api);
    expect(c.init()).toBe(false);
    expect(c.lastError?.code).toBe('exception');
  });
});

describe('ProgressTracker with an LMS', () => {
  it('sets incomplete on first launch, then completed when the rule is met, with valid SCORM values', () => {
    const api = asApi(lms());
    const t = new ProgressTracker(content('open-all'), { api, storage: null });
    t.start();
    vi.advanceTimersByTime(1000);
    expect(api.cmi.core.lesson_status).toBe('incomplete');
    t.openModel('m1');
    vi.advanceTimersByTime(1000);
    expect(api.cmi.core.lesson_status).toBe('incomplete');
    expect(api.cmi.core.lesson_location).toBe('m1');
    vi.advanceTimersByTime(30_000);
    t.openModel('m2');
    // completion is committed immediately, without waiting for the debounce
    expect(api.cmi.core.lesson_status).toBe('completed');
    expect(t.getState().completed).toBe(true);
    expect(api.writes['cmi.core.session_time']).toMatch(/^\d{4}:\d{2}:\d{2}\.\d{2}$/);
    expect(api.rejected).toEqual([]);
    expect(api.cmi.suspend_data.length).toBeLessThanOrEqual(4096);
      });

  it('annotation rule needs every required annotation viewed; viewing does not complete early', () => {
    const api = asApi(lms());
    const t = new ProgressTracker(content('open-all-and-annotations'), { api, storage: null });
    t.start();
    t.openModel('m1');
    t.openModel('m2');
    t.viewAnnotation('m1', 'a1');
    t.viewAnnotation('m2', 'b1');
    vi.advanceTimersByTime(2000);
    expect(api.cmi.core.lesson_status).toBe('incomplete');
    t.viewAnnotation('m1', 'a2');
    expect(api.cmi.core.lesson_status).toBe('completed');
  });

  it('launch rule completes immediately', () => {
    const api = asApi(lms());
    new ProgressTracker(content('launch'), { api, storage: null }).start();
    vi.advanceTimersByTime(10);
    expect(api.cmi.core.lesson_status).toBe('completed');
  });

  it('resumes progress from suspend_data and the last location, and never downgrades a completed status', () => {
    const first = asApi(lms());
    const t1 = new ProgressTracker(content('open-all-and-annotations'), { api: first, storage: null });
    t1.start();
    t1.openModel('m1');
    t1.viewAnnotation('m1', 'a2');
    t1.terminate();
    expect(first.writes['cmi.core.exit']).toBe('suspend');
    expect(first.rejected).toEqual([]);
    const saved = first.cmi.suspend_data;
    expect(saved).toMatch(/^a1\|h1\|/);

    const second = asApi(lms({ entry: 'resume', lesson_status: 'incomplete' }));
    second.cmi.suspend_data = saved;
    const t2 = new ProgressTracker(content('open-all-and-annotations'), { api: second, storage: null });
    t2.start();
    const s = t2.getState();
    expect(s.resumed).toBe(true);
    expect(s.progress.opened).toEqual(['m1']);
    expect(s.progress.viewed).toEqual({ m1: ['a2'] });
    expect(s.progress.lastModelId).toBe('m1');

    const done = asApi(lms({ lesson_status: 'completed', entry: 'resume' }));
    const t3 = new ProgressTracker(content('open-all'), { api: done, storage: null });
    t3.start();
    t3.openModel('m1');
    vi.advanceTimersByTime(2000);
    expect(done.cmi.core.lesson_status).toBe('completed');
    expect(t3.getState().completed).toBe(true);
  });

  it('discards annotation progress when the package content hash changed', () => {
    const first = asApi(lms());
    const t1 = new ProgressTracker(content('open-all'), { api: first, storage: null });
    t1.start();
    t1.openModel('m1');
    t1.terminate();
    const changed = { ...content('open-all'), contentHash: 'h2' };
    const second = asApi(lms({ entry: 'resume' }));
    second.cmi.suspend_data = first.cmi.suspend_data;
    const t2 = new ProgressTracker(changed, { api: second, storage: null });
    t2.start();
    expect(t2.getState().progress.opened).toEqual([]);
    expect(t2.getState().contentChanged).toBe(true);
  });

  it('terminates exactly once and finishes the session', () => {
    const api = asApi(lms());
    const finish = vi.spyOn(api, 'LMSFinish');
    const t = new ProgressTracker(content('open-all'), { api, storage: null });
    t.start();
    t.openModel('m1');
    t.terminate();
    t.terminate();
    t.terminate();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(api.isTerminated?.() ?? true).toBeTruthy();
  });

  it('does not write in browse mode and says so', () => {
    const writes: string[] = [];
    const api: Scorm12Api = {
      LMSInitialize: () => 'true',
      LMSFinish: () => 'true',
      LMSGetValue: (n) => (n === 'cmi.core.lesson_mode' ? 'browse' : n === 'cmi.core.lesson_status' ? 'browsed' : ''),
      LMSSetValue: (n) => (writes.push(n), 'true'),
      LMSCommit: () => 'true',
      LMSGetLastError: () => '0',
      LMSGetErrorString: () => '',
      LMSGetDiagnostic: () => '',
    };
    const t = new ProgressTracker(content('open-all'), { api, storage: null });
    t.start();
    t.openModel('m1');
    vi.advanceTimersByTime(5000);
    t.terminate();
    expect(t.getState().mode).toBe('browse');
    expect(t.getState().notice).toMatch(/browse mode/);
    expect(writes).toEqual([]);
  });
});

describe('LMS failure handling', () => {
  function flaky(failing: { value: boolean }) {
    const store: Record<string, string> = { 'cmi.core.lesson_status': 'not attempted' };
    const calls: string[] = [];
    let err = '0';
    const api: Scorm12Api = {
      LMSInitialize: () => 'true',
      LMSFinish: () => 'true',
      LMSGetValue: (n) => ((err = '0'), store[n] ?? ''),
      LMSSetValue: (n, v) => {
        calls.push(`${n}=${v}`);
        if (failing.value) return (err = '391'), 'false';
        err = '0';
        store[n] = v;
        return 'true';
      },
      LMSCommit: () => (failing.value ? ((err = '391'), 'false') : ((err = '0'), 'true')),
      LMSGetLastError: () => err,
      LMSGetErrorString: (c) => (c === '391' ? 'General commit failure' : ''),
      LMSGetDiagnostic: () => '',
    };
    return { api, store, calls };
  }

  it('keeps working when the LMS rejects writes, reports a readable notice and recovers', () => {
    const failing = { value: false };
    const { api, store } = flaky(failing);
    const local = mem();
    const t = new ProgressTracker(content('open-all'), { api, storage: local, retryMs: 5000 });
    t.start();
    failing.value = true;
    t.openModel('m1');
    vi.advanceTimersByTime(1000);
    let s = t.getState();
    expect(s.health).toBe('degraded');
    expect(s.notice).toMatch(/could not save your progress/);
    expect(s.notice).not.toMatch(/at \w+\.\w+ \(/); // no stack traces
    expect(s.progress.opened).toEqual(['m1']); // learner's progress is not lost
    expect(local.m.size).toBe(1); // local safety copy exists
    // LMS recovers: the retry timer sends everything
    failing.value = false;
    vi.advanceTimersByTime(6000);
    s = t.getState();
    expect(s.health).toBe('ok');
    expect(s.notice).toBeNull();
    expect(store['cmi.suspend_data']).toMatch(/^a1\|h1\|/);
    // completion that occurred while degraded still reaches the LMS
    t.openModel('m2');
    expect(store['cmi.core.lesson_status']).toBe('completed');
  });

  it('falls back to standalone when LMSInitialize fails, without throwing', () => {
    const api: Scorm12Api = { LMSInitialize: () => 'false', LMSFinish: () => 'true', LMSGetValue: () => '', LMSSetValue: () => 'true', LMSCommit: () => 'true', LMSGetLastError: () => '101', LMSGetErrorString: () => 'General exception', LMSGetDiagnostic: () => '' };
    const t = new ProgressTracker(content('open-all'), { api, storage: mem() });
    expect(() => t.start()).not.toThrow();
    const s = t.getState();
    expect(s.mode).toBe('standalone');
    expect(s.health).toBe('degraded');
    expect(s.notice).toMatch(/did not start a tracking session/);
    t.openModel('m1');
    expect(t.getState().progress.opened).toEqual(['m1']);
    expect(() => t.terminate()).not.toThrow();
  });

  it('survives an LMS that throws on every call', () => {
    const boom = () => { throw new Error('LMS exploded'); };
    const api = { LMSInitialize: () => 'true', LMSFinish: boom, LMSGetValue: boom, LMSSetValue: boom, LMSCommit: boom, LMSGetLastError: boom, LMSGetErrorString: boom, LMSGetDiagnostic: boom } as unknown as Scorm12Api;
    const t = new ProgressTracker(content('open-all'), { api, storage: mem() });
    expect(() => {
      t.start();
      t.openModel('m1');
      t.openModel('m2');
      vi.advanceTimersByTime(20_000);
      t.terminate();
    }).not.toThrow();
    expect(t.getState().completed).toBe(true);
  });
});

describe('standalone mode', () => {
  it('claims no LMS tracking and resumes from local storage', () => {
    const local = mem();
    const a = new ProgressTracker(content('open-all'), { api: null, storage: local });
    a.start();
    expect(a.getState().mode).toBe('standalone');
    expect(a.getState().notice).toBeNull();
    a.openModel('m1');
    a.terminate();
    const b = new ProgressTracker(content('open-all'), { api: null, storage: local });
    b.start();
    expect(b.getState().progress.opened).toEqual(['m1']);
    expect(b.getState().resumed).toBe(true);
    expect(b.getState().completed).toBe(false);
  });
  it('works without any storage (preview)', () => {
    const t = new ProgressTracker(content('open-all'), { api: null, storage: null });
    t.start();
    t.openModel('m1');
    t.openModel('m2');
    expect(t.getState().completed).toBe(true);
  });
});

describe('review fixes: status recovery and local mirror', () => {
  it("re-sends lesson_status 'incomplete' after the LMS recovers (it was rejected at launch)", () => {
    const store: Record<string, string> = { 'cmi.core.lesson_status': 'not attempted' };
    let failing = true;
    let err = '0';
    const api: Scorm12Api = {
      LMSInitialize: () => 'true',
      LMSFinish: () => 'true',
      LMSGetValue: (n) => ((err = '0'), store[n] ?? ''),
      LMSSetValue: (n, v) => (failing ? ((err = '391'), 'false') : ((err = '0'), (store[n] = v), 'true')),
      LMSCommit: () => (failing ? ((err = '391'), 'false') : ((err = '0'), 'true')),
      LMSGetLastError: () => err,
      LMSGetErrorString: () => 'General commit failure',
      LMSGetDiagnostic: () => '',
    };
    const t = new ProgressTracker(content('open-all'), { api, storage: null, retryMs: 3000 });
    t.start();
    t.openModel('m1');
    vi.advanceTimersByTime(1500);
    expect(store['cmi.core.lesson_status']).toBe('not attempted');
    failing = false;
    vi.advanceTimersByTime(4000);
    expect(store['cmi.core.lesson_status']).toBe('incomplete');
    expect(t.getState().health).toBe('ok');
  });

  it('ignores stale local progress for a brand-new attempt (it must not complete a fresh attempt)', () => {
    const local = mem();
    const old = new ProgressTracker(content('open-all'), { api: null, storage: local });
    old.start();
    old.openModel('m1');
    old.openModel('m2'); // completed in an earlier attempt
    old.terminate();
    const api = asApi(lms()); // fresh attempt: ab-initio, not attempted
    const t = new ProgressTracker(content('open-all'), { api, storage: local });
    t.start();
    expect(t.getState().completed).toBe(false);
    expect(t.getState().progress.opened).toEqual([]);
    vi.advanceTimersByTime(1500);
    expect(api.cmi.core.lesson_status).toBe('incomplete');
  });

  it('never shows one learner another learner\'s local progress on a shared computer, nor copies local completion into the LMS', () => {
    const local = mem();
    const asLearner = (id: string, extra: Record<string, string> = {}) => {
      const api = asApi(lms({ entry: 'resume', lesson_status: 'incomplete', ...extra }));
      const read = api.LMSGetValue.bind(api);
      api.LMSGetValue = (n: string) => (n === 'cmi.core.student_id' ? id : read(n));
      return api;
    };
    const apiA = asLearner('learner-a');
    const a = new ProgressTracker(content('open-all'), { api: apiA, storage: local });
    a.start();
    a.openModel('m1');
    a.openModel('m2'); // learner A completes on this computer
    a.terminate();
    expect(a.getState().completed).toBe(true);
    // Learner B, mid-attempt elsewhere, uses the same computer
    const apiB = asLearner('learner-b');
    const b = new ProgressTracker(content('open-all'), { api: apiB, storage: local });
    b.start();
    vi.advanceTimersByTime(2000);
    expect(b.getState().progress.opened).toEqual([]);
    expect(b.getState().completed).toBe(false);
    expect(apiB.writes['cmi.core.lesson_status']).not.toBe('completed');
    // Learner A returning on the same computer still gets their own local copy merged
    const apiA2 = asLearner('learner-a');
    const a2 = new ProgressTracker(content('open-all'), { api: apiA2, storage: local });
    a2.start();
    expect(a2.getState().progress.opened.sort()).toEqual(['m1', 'm2']);
  });

  it('merges this learner\'s local copy when the LMS never received it, and sends it to the LMS', () => {
    const local = mem();
    // Session 1: the LMS accepts the session but rejects every write, so progress only reaches the local copy
    let err = '0';
    const broken: Scorm12Api = {
      LMSInitialize: () => 'true',
      LMSFinish: () => 'true',
      LMSGetValue: (n) => ((err = '0'), n === 'cmi.core.student_id' ? 'learner-s1' : n === 'cmi.core.lesson_status' ? 'not attempted' : ''),
      LMSSetValue: () => ((err = '391'), 'false'),
      LMSCommit: () => ((err = '391'), 'false'),
      LMSGetLastError: () => err,
      LMSGetErrorString: () => 'General commit failure',
      LMSGetDiagnostic: () => '',
    };
    const first = new ProgressTracker(content('open-all'), { api: broken, storage: local, retryMs: 600000 });
    first.start();
    first.openModel('m1');
    first.viewAnnotation('m1', 'a1');
    vi.advanceTimersByTime(1500);
    first.terminate();
    // Session 2: the same learner relaunches; the LMS has an attempt in progress but no suspend_data
    const api = asApi(lms({ entry: 'resume', lesson_status: 'incomplete' }));
    const read = api.LMSGetValue.bind(api);
    api.LMSGetValue = (n: string) => (n === 'cmi.core.student_id' ? 'learner-s1' : read(n));
    const t = new ProgressTracker(content('open-all'), { api, storage: local });
    t.start();
    expect(t.getState().progress.opened).toEqual(['m1']);
    expect(t.getState().progress.viewed).toEqual({ m1: ['a1'] });
    vi.advanceTimersByTime(1500);
    expect(api.cmi.suspend_data).toMatch(/^a1\|h1\|/);
    expect(api.rejected).toEqual([]);
  });
});
