import { RotateCcw } from 'lucide-react';
import { DEFAULT_BACKGROUND, DEFAULT_LIGHTING, type BackgroundSetting, type LightingSettings } from '../../shared/types';

const BACKGROUNDS: { name: string; value: BackgroundSetting }[] = [
  { name: 'Soft grey (default)', value: DEFAULT_BACKGROUND },
  { name: 'White', value: { type: 'solid', color: '#ffffff' } },
  { name: 'Pale blue', value: { type: 'gradient', top: '#f0f7fb', bottom: '#c5dceb' } },
  { name: 'Warm paper', value: { type: 'gradient', top: '#faf6ee', bottom: '#e8dfcc' } },
  { name: 'Slate', value: { type: 'gradient', top: '#3d4a56', bottom: '#1c252e' } },
  { name: 'Black', value: { type: 'solid', color: '#000000' } },
];

const swatch = (b: BackgroundSetting) => (b.type === 'solid' ? b.color : `linear-gradient(180deg, ${b.top}, ${b.bottom})`);
const same = (a: BackgroundSetting, b: BackgroundSetting) => JSON.stringify(a) === JSON.stringify(b);

function Slider({ id, label, value, min, max, step, onChange, unit = '' }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <div className="slider">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output htmlFor={id}>{Number.isInteger(step) ? value : value.toFixed(2)}{unit}</output>
    </div>
  );
}

export function AppearancePanel({ background, lighting, onBackground, onLighting }: { background: BackgroundSetting; lighting: LightingSettings; onBackground: (b: BackgroundSetting) => void; onLighting: (l: LightingSettings) => void }) {
  const set = (patch: Partial<LightingSettings>) => onLighting({ ...lighting, ...patch });
  const custom = !BACKGROUNDS.some((b) => same(b.value, background));
  return (
    <div className="appearance">
      <fieldset className="field">
        <legend className="label">Background</legend>
        <div className="swatches" role="group" aria-label="Background presets">
          {BACKGROUNDS.map((b) => (
            <button key={b.name} type="button" className="swatch" style={{ background: swatch(b.value) }} aria-pressed={same(b.value, background)} aria-label={b.name} title={b.name} onClick={() => onBackground(b.value)} />
          ))}
          <label className={`swatch swatch--custom ${custom ? 'is-on' : ''}`} title="Custom colour">
            <span className="sr-only">Custom background colour</span>
            <input type="color" value={background.type === 'solid' ? background.color : '#dfe5ec'} onChange={(e) => onBackground({ type: 'solid', color: e.target.value })} />
          </label>
        </div>
        <span className="hint">The background is saved with the model and shown to students. The thumbnail is rendered on it.</span>
      </fieldset>
      <fieldset className="field">
        <legend className="label">Lighting</legend>
        <Slider id="lt-exposure" label="Brightness" value={lighting.exposure} min={0.4} max={2.2} step={0.05} onChange={(exposure) => set({ exposure })} />
        <Slider id="lt-ambient" label="Fill light" value={lighting.ambient} min={0} max={1.6} step={0.05} onChange={(ambient) => set({ ambient })} />
        <Slider id="lt-key" label="Key light" value={lighting.key} min={0} max={4} step={0.1} onChange={(key) => set({ key })} />
        <Slider id="lt-az" label="Key light angle (left–right)" value={lighting.keyAzimuth} min={-180} max={180} step={5} unit="°" onChange={(keyAzimuth) => set({ keyAzimuth })} />
        <Slider id="lt-el" label="Key light height" value={lighting.keyElevation} min={-20} max={85} step={5} unit="°" onChange={(keyElevation) => set({ keyElevation })} />
        <label className="check"><input type="checkbox" checked={lighting.headlight} onChange={(e) => set({ headlight: e.target.checked })} /><span>Light follows the camera<br /><span className="hint">Keeps the side you are looking at lit as you rotate.</span></span></label>
        <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={lighting.environment} onChange={(e) => set({ environment: e.target.checked })} /><span>Soft studio reflections</span></label>
        <button type="button" className="btn btn--sm" style={{ marginTop: 12 }} onClick={() => onLighting({ ...DEFAULT_LIGHTING })}><RotateCcw /> Reset lighting</button>
      </fieldset>
    </div>
  );
}
