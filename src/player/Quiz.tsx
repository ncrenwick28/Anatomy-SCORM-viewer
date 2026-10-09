import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleHelp, Crosshair, ListChecks, RotateCcw, SkipForward, Trophy, X, MinusCircle, Target } from 'lucide-react';
import type { Annotation } from '../shared/types';
import { buildQuestionIds, countOptions, judgePick, resultMessage, summarise, type QuizAnswer } from '../shared/quiz';
import { RichText } from '../ui/RichText';

export type QuizPhase = 'intro' | 'asking' | 'feedback' | 'results';

interface QuizState {
  phase: QuizPhase;
  ids: string[];
  index: number;
  answers: QuizAnswer[];
  /** Annotation shown on the model while reviewing the recap. */
  reviewId: string | null;
  /** Gentle, transient message (e.g. the click missed the model). */
  nudge: string | null;
}

const INITIAL: QuizState = { phase: 'intro', ids: [], index: 0, answers: [], reviewId: null, nudge: null };

export interface QuizController {
  state: QuizState;
  current: Annotation | null;
  /** Annotations that should be drawn on the model right now (none while a question is open). */
  viewAnnotations: Annotation[];
  selectedId: string | null;
  /** True while the learner is expected to click on the model. */
  picking: boolean;
  start: (count?: number, only?: string[]) => void;
  pick: (hit: { meshKey: string; position: [number, number, number] } | null) => void;
  chooseFromList: (id: string) => void;
  skip: () => void;
  next: () => void;
  review: (id: string | null) => void;
  backToStart: () => void;
  reset: () => void;
}

/** State machine of the quiz. The 3D view is driven from the outputs (`viewAnnotations`, `selectedId`, `picking`). */
export function useQuiz(annotations: Annotation[]): QuizController {
  const [state, setState] = useState<QuizState>(INITIAL);
  const byId = useMemo(() => new Map(annotations.map((a) => [a.id, a])), [annotations]);
  const current = state.phase === 'asking' || state.phase === 'feedback' ? byId.get(state.ids[state.index]) ?? null : null;

  const record = useCallback((answer: QuizAnswer) => setState((s) => ({ ...s, phase: 'feedback', nudge: null, answers: [...s.answers.slice(0, s.index), answer] })), []);

  const start = useCallback(
    (count?: number, only?: string[]) => {
      const pool = only ? annotations.filter((a) => only.includes(a.id)) : annotations;
      const ids = buildQuestionIds(pool, count);
      if (ids.length === 0) return;
      setState({ phase: 'asking', ids, index: 0, answers: [], reviewId: null, nudge: null });
    },
    [annotations],
  );

  const pick = useCallback<QuizController['pick']>(
    (hit) => {
      if (state.phase !== 'asking' || !current) return;
      if (!hit) {
        setState((s) => ({ ...s, nudge: 'That click did not land on the model. Click directly on the structure.' }));
        return;
      }
      const j = judgePick(current.id, annotations, hit);
      record({ annotationId: current.id, outcome: j.correct ? 'correct' : 'wrong', clickedId: j.clickedId, method: 'model' });
    },
    [state.phase, current, annotations, record],
  );

  const chooseFromList = useCallback(
    (id: string) => {
      if (state.phase !== 'asking' || !current) return;
      const ok = id === current.id;
      record({ annotationId: current.id, outcome: ok ? 'correct' : 'wrong', clickedId: ok ? null : id, method: 'list' });
    },
    [state.phase, current, record],
  );

  const skip = useCallback(() => {
    if (state.phase !== 'asking' || !current) return;
    record({ annotationId: current.id, outcome: 'skipped', clickedId: null, method: 'skipped' });
  }, [state.phase, current, record]);

  const next = useCallback(() => {
    setState((s) => (s.index + 1 >= s.ids.length ? { ...s, phase: 'results', reviewId: null, nudge: null } : { ...s, phase: 'asking', index: s.index + 1, nudge: null }));
  }, []);

  const review = useCallback((id: string | null) => setState((s) => ({ ...s, reviewId: id })), []);
  const backToStart = useCallback(() => setState((s) => ({ ...INITIAL, phase: 'intro', ids: s.ids })), []);
  const reset = useCallback(() => setState(INITIAL), []);

  const reviewing = state.phase === 'results' && state.reviewId ? byId.get(state.reviewId) ?? null : null;
  const shown = state.phase === 'feedback' ? current : reviewing;

  return {
    state,
    current,
    viewAnnotations: shown ? [shown] : [],
    selectedId: shown?.id ?? null,
    picking: state.phase === 'asking',
    start,
    pick,
    chooseFromList,
    skip,
    next,
    review,
    backToStart,
    reset,
  };
}

interface PanelProps {
  quiz: QuizController;
  annotations: Annotation[];
  onCentrePick: () => void;
  /** Show where an annotation is (turn the camera to it). */
  onShowOnModel: (id: string) => void;
}

const outcomeText: Record<QuizAnswer['outcome'], string> = { correct: 'Correct', wrong: 'Incorrect', skipped: 'Skipped' };
const OutcomeIcon = ({ o }: { o: QuizAnswer['outcome'] }) => (o === 'correct' ? <Check aria-hidden="true" /> : o === 'wrong' ? <X aria-hidden="true" /> : <MinusCircle aria-hidden="true" />);

export function QuizPanel({ quiz, annotations, onCentrePick, onShowOnModel }: PanelProps) {
  const { state } = quiz;
  const byId = useMemo(() => new Map(annotations.map((a) => [a.id, a])), [annotations]);
  const label = (id: string | null) => (id ? byId.get(id)?.label ?? 'a structure' : null);

  // Each new question: move focus to it so a screen-reader user hears it.
  useEffect(() => {
    if (state.phase === 'asking') document.getElementById('pl-quiz-q')?.focus({ preventScroll: true });
  }, [state.phase, state.index]);

  if (state.phase === 'intro') {
    return <Intro annotations={annotations} onStart={(n) => quiz.start(n)} />;
  }
  if (state.phase === 'results') {
    return <Results quiz={quiz} byId={byId} onShowOnModel={onShowOnModel} />;
  }

  const total = state.ids.length;
  const answered = state.answers.length;
  const score = state.answers.filter((a) => a.outcome === 'correct').length;
  const q = quiz.current;
  const answer = state.phase === 'feedback' ? state.answers[state.index] : null;
  const last = state.index + 1 >= total;

  return (
    <div className="pl-quiz" data-testid="quiz">
      <div className="pl-quiz__head">
        <span className="pl-quiz__qn">Question {state.index + 1} of {total}</span>
        <span className="pl-quiz__score" aria-label={`Score so far: ${score} out of ${answered}`}>Score {score}/{answered}</span>
      </div>
      <div className="pl-quiz__bar" role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}>
        <i style={{ width: `${(answered / total) * 100}%` }} />
      </div>

      {q && state.phase === 'asking' && (
        <>
          <div className="pl-quiz__ask" role="group" aria-labelledby="pl-quiz-q">
            <Target aria-hidden="true" />
            <div>
              <p className="hint">Find this structure on the model</p>
              <h2 id="pl-quiz-q" tabIndex={-1} data-testid="quiz-question">Click on the {q.label}</h2>
              {q.category && <span className="chip chip--accent">{q.category}</span>}
            </div>
          </div>
          <p className="hint">Rotate and zoom the model if you need to, then click the structure. You have one try for each question.</p>
          {state.nudge && <p className="callout callout--warn" role="status">{state.nudge}</p>}
          <div className="pl-quiz__actions">
            <button type="button" className="btn" onClick={onCentrePick} title="Choose whatever is in the middle of the view – useful with a keyboard">
              <Crosshair /> Choose the centre of the view
            </button>
            <button type="button" className="btn" onClick={quiz.skip}><SkipForward /> Skip</button>
          </div>
          <details className="pl-quiz__alt">
            <summary>Can’t click the model? Choose from a list instead</summary>
            <ul>
              {annotations
                .slice()
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((a) => (
                  <li key={a.id}><button type="button" className="btn btn--sm" onClick={() => quiz.chooseFromList(a.id)}>{a.label}</button></li>
                ))}
            </ul>
          </details>
        </>
      )}

      {q && answer && (
        <div className={`pl-quiz__feedback pl-quiz__feedback--${answer.outcome}`} data-testid="quiz-feedback" role="status">
          <h2><OutcomeIcon o={answer.outcome} /> {answer.outcome === 'correct' ? 'Correct!' : answer.outcome === 'wrong' ? 'Not quite' : 'Skipped'}</h2>
          {answer.outcome === 'correct' && <p>You found the <strong>{q.label}</strong>.</p>}
          {answer.outcome === 'wrong' && (
            <p>
              {answer.clickedId ? <>You chose the <strong>{label(answer.clickedId)}</strong>. </> : answer.method === 'model' ? <>You clicked a different structure. </> : null}
              The <strong>{q.label}</strong> is marked on the model.
            </p>
          )}
          {answer.outcome === 'skipped' && <p>The <strong>{q.label}</strong> is marked on the model.</p>}
          {q.description.trim() && <RichText text={q.description} />}
          <div className="pl-quiz__actions">
            <button type="button" className="btn btn--primary" autoFocus onClick={quiz.next} data-testid="quiz-next">{last ? 'See my score' : 'Next question'}</button>
            {answer.outcome !== 'correct' && <button type="button" className="btn" onClick={() => onShowOnModel(q.id)}><Crosshair /> Show on model</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function Intro({ annotations, onStart }: { annotations: Annotation[]; onStart: (count?: number) => void }) {
  const n = annotations.length;
  const opts = countOptions(n);
  const [count, setCount] = useState(opts[opts.length - 1]);
  return (
    <div className="pl-quiz pl-quiz--intro" data-testid="quiz-intro">
      <div className="pl-quiz__badge" aria-hidden="true"><CircleHelp /></div>
      <h2>Test yourself</h2>
      <p>You will be asked to <strong>click on a labelled structure</strong> on the model. At the end you get a score and can look back over what you got right and wrong.</p>
      <ul className="hint pl-quiz__rules">
        <li>The labels are hidden while you answer.</li>
        <li>Questions come in a random order, one try each.</li>
        <li>The quiz does not change your completion status.</li>
      </ul>
      {opts.length > 1 && (
        <fieldset className="pl-quiz__count">
          <legend>Number of questions</legend>
          {opts.map((c) => (
            <label key={c} className={`pl-chipbtn ${count === c ? 'is-on' : ''}`}>
              <input type="radio" name="quiz-count" checked={count === c} onChange={() => setCount(c)} /> {c === n ? `All ${n}` : c}
            </label>
          ))}
        </fieldset>
      )}
      <button type="button" className="btn btn--primary" onClick={() => onStart(count)} data-testid="quiz-start">Start quiz</button>
    </div>
  );
}

type Filter = 'all' | 'correct' | 'wrong';

function Results({ quiz, byId, onShowOnModel }: { quiz: QuizController; byId: Map<string, Annotation>; onShowOnModel: (id: string) => void }) {
  const { answers, reviewId } = quiz.state;
  const sum = summarise(answers);
  const [filter, setFilter] = useState<Filter>('all');
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus({ preventScroll: true }), []);
  const missed = answers.filter((a) => a.outcome !== 'correct').map((a) => a.annotationId);
  const shown = answers.filter((a) => (filter === 'all' ? true : filter === 'correct' ? a.outcome === 'correct' : a.outcome !== 'correct'));
  const sel = reviewId ? byId.get(reviewId) : null;

  return (
    <div className="pl-quiz pl-quiz--results" data-testid="quiz-results">
      <div className="pl-quiz__trophy" aria-hidden="true"><Trophy /></div>
      <h2 tabIndex={-1} ref={headingRef}>Your score</h2>
      <p className="pl-quiz__big" data-testid="quiz-score" aria-label={`You scored ${sum.correct} out of ${sum.total}, ${sum.percent} percent`}>
        <strong>{sum.correct}</strong> / {sum.total} <span>({sum.percent}%)</span>
      </p>
      <div className="pl-quiz__bar pl-quiz__bar--big" aria-hidden="true"><i style={{ width: `${sum.percent}%` }} /></div>
      <p>{resultMessage(sum.percent)}</p>
      <p className="hint">{sum.correct} correct · {sum.wrong} incorrect · {sum.skipped} skipped</p>

      <div className="pl-quiz__actions">
        {missed.length > 0 && <button type="button" className="btn btn--primary" onClick={() => quiz.start(undefined, missed)} data-testid="quiz-retry-missed"><RotateCcw /> Retry the {missed.length} I missed</button>}
        <button type="button" className={`btn ${missed.length ? '' : 'btn--primary'}`} onClick={() => quiz.start()} data-testid="quiz-again"><RotateCcw /> New quiz</button>
        <button type="button" className="btn" onClick={quiz.backToStart}>Change settings</button>
      </div>

      <h3 className="pl-quiz__recap-title"><ListChecks aria-hidden="true" /> Recap</h3>
      <div className="pl-quiz__filters" role="group" aria-label="Filter the recap">
        {([['all', `All (${sum.total})`], ['correct', `Right (${sum.correct})`], ['wrong', `Wrong or skipped (${sum.wrong + sum.skipped})`]] as [Filter, string][]).map(([k, text]) => (
          <button key={k} type="button" className={`pl-chipbtn ${filter === k ? 'is-on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{text}</button>
        ))}
      </div>
      <ol className="pl-quiz__recap" data-testid="quiz-recap">
        {shown.map((a) => {
          const target = byId.get(a.annotationId);
          if (!target) return null;
          const open = reviewId === a.annotationId;
          return (
            <li key={a.annotationId} className={`pl-quiz__item pl-quiz__item--${a.outcome} ${open ? 'is-open' : ''}`} data-outcome={a.outcome}>
              <button
                type="button"
                className="pl-quiz__itembtn"
                aria-expanded={open}
                onClick={() => {
                  quiz.review(open ? null : a.annotationId);
                  if (!open) onShowOnModel(a.annotationId);
                }}
              >
                <span className={`pl-quiz__mark pl-quiz__mark--${a.outcome}`}><OutcomeIcon o={a.outcome} /> <span>{outcomeText[a.outcome]}</span></span>
                <span className="pl-quiz__itemname">{target.label}</span>
                {a.outcome === 'wrong' && a.clickedId && <span className="hint">You chose: {byId.get(a.clickedId)?.label}</span>}
                {a.outcome === 'wrong' && !a.clickedId && a.method === 'model' && <span className="hint">You clicked a different structure</span>}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="hint">Nothing to show here.</li>}
      </ol>
      {sel && (
        <div className="pl-quiz__detail" data-testid="quiz-review-detail">
          <h4>{sel.label}</h4>
          {sel.description.trim() ? <RichText text={sel.description} /> : <p className="hint">No description.</p>}
          <p className="hint">It is marked on the model.</p>
        </div>
      )}
    </div>
  );
}
