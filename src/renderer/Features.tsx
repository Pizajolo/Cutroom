import { useEffect, useState } from 'react';
import type { Feature, FeatureState, Pricing } from '../shared/features';
import { api } from './lib';

const PRICING: Record<Pricing, string> = { free: 'Free', subscription: 'Subscription', 'on-demand': 'Pay per use' };

/**
 * What Cutroom can currently do, with a switch for each capability.
 * On Home the switches are the defaults for every project; inside a project they apply to that project only.
 */
export function Features({ scope }: { scope: 'everywhere' | 'project' }) {
  const [states, setStates] = useState<FeatureState[]>([]);
  useEffect(() => void api.features().then(setStates), []);

  /** Change a feature's default (on/off, or which model provides it) in Settings. */
  const setDefault = async (id: Feature, patch: { on?: boolean; model?: string }): Promise<void> => {
    const settings = await api.getSettings();
    await api.saveSettings({ ...settings, features: { ...settings.features, [id]: { ...settings.features[id], ...patch } } });
    setStates(await api.features());
  };
  const toggle = (s: FeatureState, on: boolean): void =>
    void (scope === 'project' ? api.setProjectFeature(s.id, on).then(setStates) : setDefault(s.id, { on }));

  const groups = [...new Set(states.map((s) => s.group))];
  return (
    <div className="features">
      {groups.map((group) => (
        <section key={group}>
          <h2>{group}</h2>
          {states.filter((s) => s.group === group).map((s) => {
            // In a project you can only switch off what is available at all.
            const available = scope === 'project' ? s.on && s.connected : true;
            const checked = scope === 'project' ? s.active : s.on;
            const status = !s.connected ? 'Not connected' : !s.on ? 'Off in Settings' : s.offHere ? 'Off in this project' : 'Active';
            return (
              <label key={s.id} className={s.active ? 'feature' : 'feature idle'}>
                <input type="checkbox" checked={checked} disabled={!available} onChange={(e) => toggle(s, e.target.checked)} />
                <span className="name">{s.label}</span>
                {scope === 'everywhere' && s.models ? (
                  <>
                    <input
                      className="grow" list={`models-${s.id}`} key={s.model} defaultValue={s.model} title="provider:model — pick a suggestion or paste another model id"
                      onBlur={(e) => e.target.value.trim() && e.target.value !== s.model && void setDefault(s.id, { model: e.target.value.trim() })}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    />
                    <datalist id={`models-${s.id}`}>{s.models.map((m) => <option key={m} value={m} />)}</datalist>
                  </>
                ) : (
                  <span className="grow via">{s.via}</span>
                )}
                <span className="tag">{PRICING[s.pricing]}</span>
                <span className={s.active ? 'tag ok' : 'tag'}>{status}</span>
              </label>
            );
          })}
        </section>
      ))}
    </div>
  );
}
