import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export function useMedia(query: string): boolean {
  const get = () => (typeof matchMedia === 'function' ? matchMedia(query).matches : false);
  const [m, setM] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

/**
 * Full-screen for a stage element. Uses the Fullscreen API where the browser (and any embedding iframe)
 * allows it. Many LMSs embed content in an iframe without `allowfullscreen`; in that case it falls back
 * to expanding the stage to fill the frame, so the control always does something useful.
 */
export function useFullscreen(target: RefObject<HTMLElement | null>) {
  const [native, setNative] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const supported = typeof document !== 'undefined' && !!document.fullscreenEnabled;

  useEffect(() => {
    const on = () => setNative(document.fullscreenElement === target.current && !!target.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, [target]);

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    el.classList.toggle('is-expanded', expanded);
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      el.classList.remove('is-expanded');
    };
  }, [expanded, target]);

  const toggle = useCallback(async () => {
    const el = target.current;
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (supported) {
      try {
        await el.requestFullscreen();
        return;
      } catch {
        /* denied (e.g. iframe without allowfullscreen): fall through to the expanded layout */
      }
    }
    setExpanded(true);
  }, [expanded, supported, target]);

  return { active: native || expanded, toggle };
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
