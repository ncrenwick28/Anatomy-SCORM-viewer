import type { Category } from '../../shared/types';

/** A labelled group of checkboxes (any number may be ticked) for body regions / systems. */
export function CheckboxGroup({ legend, options, value, onChange, hint, idPrefix }: { legend: string; options: Category[]; value: string[]; onChange: (v: string[]) => void; hint?: string; idPrefix: string }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const unknown = value.filter((id) => !options.some((o) => o.id === id));
  return (
    <fieldset className="field cat-group">
      <legend className="label">{legend}</legend>
      {hint && <p className="hint" style={{ margin: 0 }}>{hint}</p>}
      <div className="cat-options">
        {options.map((o) => (
          <label key={o.id} className={`chip-check ${value.includes(o.id) ? 'is-on' : ''}`}>
            <input type="checkbox" id={`${idPrefix}-${o.id}`} checked={value.includes(o.id)} onChange={() => toggle(o.id)} />
            <span>{o.name}</span>
          </label>
        ))}
        {unknown.map((id) => (
          <label key={id} className="chip-check is-on is-unknown" title="This category no longer exists. Untick to remove it.">
            <input type="checkbox" checked onChange={() => toggle(id)} />
            <span>(deleted category)</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
