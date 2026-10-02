/**
 * Minimal, defensive SCORM 1.2 run-time client.
 *
 * It implements the SCO side of the SCORM 1.2 API adapter contract (finding `window.API` in a parent or
 * opener frame, LMSInitialize / GetValue / SetValue / Commit / Finish, and error reporting). Every call
 * is wrapped so an LMS that throws, returns "false" or disappears can never break the learner's session.
 */

export interface Scorm12Api {
  LMSInitialize(arg: string): string | boolean;
  LMSFinish(arg: string): string | boolean;
  LMSGetValue(name: string): string;
  LMSSetValue(name: string, value: string): string | boolean;
  LMSCommit(arg: string): string | boolean;
  LMSGetLastError(): string | number;
  LMSGetErrorString(code: string | number): string;
  LMSGetDiagnostic(code: string | number): string;
}

type FrameLike = { API?: unknown; parent?: FrameLike | null; opener?: FrameLike | null };

function isApi(x: unknown): x is Scorm12Api {
  return !!x && typeof (x as Scorm12Api).LMSInitialize === 'function' && typeof (x as Scorm12Api).LMSSetValue === 'function';
}

function walk(start: FrameLike | null | undefined, maxDepth: number): Scorm12Api | null {
  let w: FrameLike | null | undefined = start;
  for (let depth = 0; w && depth < maxDepth; depth++) {
    try {
      if (isApi(w.API)) return w.API;
    } catch {
      /* cross-origin frame: cannot read API, keep climbing */
    }
    let next: FrameLike | null | undefined;
    try {
      next = w.parent;
    } catch {
      next = null;
    }
    if (!next || next === w) break;
    w = next;
  }
  return null;
}

/** Standard SCORM API discovery: this window, its parents, then the opener and its parents. */
export function findApi(win: FrameLike): Scorm12Api | null {
  const fromParents = walk(win, 500);
  if (fromParents) return fromParents;
  let opener: FrameLike | null | undefined;
  try {
    opener = win.opener;
  } catch {
    opener = null;
  }
  return opener ? walk(opener, 500) : null;
}

export interface LmsError {
  call: string;
  code: string;
  message: string;
}

/** SCORM 1.2 CMITimespan: HHHH:MM:SS.SS */
export function formatScorm12Time(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10)); // centiseconds
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000) % 60;
  const h = Math.min(9999, Math.floor(total / 360000));
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(h, 4)}:${p(m)}:${p(s)}.${p(cs)}`;
}

export class Scorm12Client {
  initialised = false;
  finished = false;
  lastError: LmsError | null = null;

  constructor(private readonly api: Scorm12Api) {}

  private truthy(v: unknown): boolean {
    return v === true || String(v).toLowerCase() === 'true';
  }

  private readError(call: string): LmsError {
    let code = '0';
    let message = '';
    try {
      code = String(this.api.LMSGetLastError());
      if (code !== '0') message = String(this.api.LMSGetErrorString(code) ?? '');
    } catch {
      code = '101';
    }
    return { call, code, message };
  }

  private fail(err: LmsError): false {
    this.lastError = err;
    return false;
  }

  init(): boolean {
    if (this.initialised) return true;
    try {
      if (this.truthy(this.api.LMSInitialize(''))) {
        this.initialised = true;
        this.lastError = null;
        return true;
      }
      return this.fail(this.readError('LMSInitialize'));
    } catch (e) {
      return this.fail({ call: 'LMSInitialize', code: 'exception', message: String(e) });
    }
  }

  /** Returns the value, or null if the LMS reported an error. */
  get(name: string): string | null {
    if (!this.initialised || this.finished) return null;
    try {
      const v = this.api.LMSGetValue(name);
      const err = this.readError(`LMSGetValue(${name})`);
      if (err.code !== '0') {
        this.lastError = err;
        return null;
      }
      return v === undefined || v === null ? '' : String(v);
    } catch (e) {
      this.lastError = { call: `LMSGetValue(${name})`, code: 'exception', message: String(e) };
      return null;
    }
  }

  set(name: string, value: string): boolean {
    if (!this.initialised || this.finished) return false;
    try {
      if (this.truthy(this.api.LMSSetValue(name, value))) return true;
      return this.fail(this.readError(`LMSSetValue(${name})`));
    } catch (e) {
      return this.fail({ call: `LMSSetValue(${name})`, code: 'exception', message: String(e) });
    }
  }

  commit(): boolean {
    if (!this.initialised || this.finished) return false;
    try {
      if (this.truthy(this.api.LMSCommit(''))) return true;
      return this.fail(this.readError('LMSCommit'));
    } catch (e) {
      return this.fail({ call: 'LMSCommit', code: 'exception', message: String(e) });
    }
  }

  finish(): boolean {
    if (!this.initialised || this.finished) return false;
    this.finished = true;
    try {
      return this.truthy(this.api.LMSFinish(''));
    } catch {
      return false;
    }
  }
}
