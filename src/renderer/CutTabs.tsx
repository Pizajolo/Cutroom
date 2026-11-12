import { Plus, X } from 'lucide-react';
import type { Cuts } from '../shared/types';
import { api, failed } from './lib';

interface Props {
  cuts: Cuts;
  onCuts: (cuts: Cuts) => void;
  /** Claude is working: its reply belongs to this chat, so no switching until it is done. */
  busy: boolean;
  /** The chat whose name is being typed. */
  renaming: string;
  setRenaming: (id: string) => void;
}

/** One tab per chat in the project. Each chat has its own edit of the same footage. */
export function CutTabs({ cuts, onCuts, busy, renaming, setRenaming }: Props) {
  const wait = busy ? 'Wait until Claude has finished, or stop it' : undefined;
  const add = (): void =>
    void api.newCut(`Chat ${cuts.cuts.length + 1}`).then((next) => (onCuts(next), setRenaming(next.active)), failed);
  const rename = (id: string, name: string): void => {
    setRenaming('');
    void api.renameCut(id, name).then(onCuts, failed);
  };
  const remove = (id: string, name: string): void => {
    if (confirm(`Move the chat “${name}” and its edit to the Trash? Videos already exported stay.`)) void api.deleteCut(id).then(onCuts, failed);
  };

  return (
    <div className="cut-tabs" role="tablist" aria-label="Chats in this project">
      {cuts.cuts.map((c) => {
        const active = c.id === cuts.active;
        if (renaming === c.id) {
          return (
            <input
              key={c.id} className="cut-name" defaultValue={c.name} autoFocus aria-label="Name of this chat"
              onFocus={(e) => e.target.select()}
              onBlur={(e) => rename(c.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') e.currentTarget.value = c.name;
                if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
              }}
            />
          );
        }
        return (
          <span key={c.id} className="cut-tab">
            <button
              role="tab" aria-selected={active} disabled={busy && !active}
              title={active ? 'Double-click to rename' : (wait ?? `Open “${c.name}”: its own chat and edit`)}
              onClick={() => !active && void api.switchCut(c.id).then(onCuts, failed)}
              onDoubleClick={() => setRenaming(c.id)}
            >
              {c.name}
            </button>
            {active && cuts.cuts.length > 1 && (
              <button className="ghost close" disabled={busy} title={wait ?? 'Delete this chat and its edit'} aria-label={`Delete ${c.name}`} onClick={() => remove(c.id, c.name)}>
                <X size={12} />
              </button>
            )}
          </span>
        );
      })}
      <button className="ghost add" disabled={busy} title={wait ?? 'New chat: another video from the same footage'} aria-label="New chat" onClick={add}>
        <Plus size={14} />
      </button>
    </div>
  );
}
