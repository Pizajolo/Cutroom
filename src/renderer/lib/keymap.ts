export type ShortcutScope = 'global' | 'editor' | 'timeline';
export interface Shortcut {
  id: string;
  key: string;
  scope: ShortcutScope;
  command?: boolean;
  shift?: boolean;
  alt?: boolean;
  allowInTextInput?: boolean;
  allowInDialog?: boolean;
  repeat?: boolean;
  enabled?: () => boolean;
  run: (event: KeyboardEvent) => void;
}

export function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [data-native-keys]');
}

function isInDialog(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"]');
}

function keyName(key: string): string {
  return key === ' ' ? 'space' : key.toLowerCase();
}

export class Keymap {
  private shortcuts = new Map<string, Shortcut>();
  private scopes: ReadonlySet<ShortcutScope> = new Set(['global']);

  setScopes(scopes: readonly ShortcutScope[]): void {
    this.scopes = new Set(['global', ...scopes]);
  }

  register(shortcut: Shortcut): () => void {
    if (this.shortcuts.has(shortcut.id)) throw new Error(`Duplicate shortcut: ${shortcut.id}`);
    this.shortcuts.set(shortcut.id, shortcut);
    return () => { this.shortcuts.delete(shortcut.id); };
  }

  handle = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing) return;
    const target = event.composedPath()[0] ?? event.target;
    const inText = isTextInput(target instanceof EventTarget ? target : null);
    const inDialog = isInDialog(target instanceof EventTarget ? target : null);
    const priorities = { global: 0, editor: 1, timeline: 2 };
    const candidates = [...this.shortcuts.values()].sort((a, b) => priorities[b.scope] - priorities[a.scope]);
    for (const shortcut of candidates) {
      if (!this.scopes.has(shortcut.scope) || keyName(event.key) !== keyName(shortcut.key)) continue;
      if (!!shortcut.command !== event.metaKey || event.ctrlKey || !!shortcut.alt !== event.altKey || !!shortcut.shift !== event.shiftKey) continue;
      if (event.repeat && !shortcut.repeat) continue;
      if (inText && !(shortcut.allowInTextInput ?? shortcut.scope === 'global')) continue;
      if (inDialog && !shortcut.allowInDialog) continue;
      if (shortcut.enabled && !shortcut.enabled()) continue;
      event.preventDefault();
      shortcut.run(event);
      return;
    }
  };

  attach(target: Window = window): () => void {
    target.addEventListener('keydown', this.handle);
    return () => target.removeEventListener('keydown', this.handle);
  }
}

export const keymap = new Keymap();
