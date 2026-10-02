import { useEffect, useState } from 'react';
import type { ProgressTracker, TrackerState } from './tracker';

export function useTracker(tracker: ProgressTracker): TrackerState {
  const [state, setState] = useState<TrackerState>(() => tracker.getState());
  useEffect(() => {
    setState(tracker.getState());
    return tracker.subscribe(setState);
  }, [tracker]);
  return state;
}
