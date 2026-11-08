import { afterEach, describe, expect, it, vi } from 'vitest';
import { Keymap } from '../../src/renderer/lib/keymap';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); document.body.replaceChildren(); });
function setup() {
  const keymap = new Keymap();
  keymap.setScopes(['editor', 'timeline']);
  cleanups.push(keymap.attach());
  return keymap;
}
function press(target: HTMLElement, key: string, modifiers: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }));
}

describe('scoped keymap', () => {
  it('suppresses editor shortcuts in inputs but lets the global new-goal shortcut fire', () => {
    const keymap = setup(); const play = vi.fn(); const newGoal = vi.fn();
    keymap.register({ id: 'play', key: ' ', scope: 'editor', run: play });
    keymap.register({ id: 'new-goal', key: 'n', command: true, scope: 'global', run: newGoal });
    const input = document.createElement('textarea'); document.body.append(input); input.focus();
    press(input, ' '); press(input, 'n', { metaKey: true });
    expect(play).not.toHaveBeenCalled(); expect(newGoal).toHaveBeenCalledOnce();
    press(document.body, ' '); expect(play).toHaveBeenCalledOnce();
  });
  it('treats descendants of contenteditable as text input', () => {
    const keymap = setup(); const split = vi.fn();
    keymap.register({ id: 'split', key: 's', scope: 'timeline', run: split });
    const editable = document.createElement('div'); editable.setAttribute('contenteditable', 'true');
    const word = document.createElement('span'); editable.append(word); document.body.append(editable);
    press(word, 's'); expect(split).not.toHaveBeenCalled();
  });
  it('does not hijack composing, repeated or already handled key events', () => {
    const keymap = setup(); const run = vi.fn();
    keymap.register({ id: 'split', key: 's', scope: 'timeline', run });
    press(document.body, 's', { isComposing: true }); press(document.body, 's', { repeat: true });
    const event = new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }); event.preventDefault(); document.body.dispatchEvent(event);
    expect(run).not.toHaveBeenCalled();
  });
  it('honours exact modifiers, scope priority and unregistering', () => {
    const keymap = setup(); const editor = vi.fn(); const timeline = vi.fn();
    keymap.register({ id: 'editor', key: 's', scope: 'editor', run: editor });
    const remove = keymap.register({ id: 'timeline', key: 's', scope: 'timeline', run: timeline });
    press(document.body, 's', { altKey: true }); expect(timeline).not.toHaveBeenCalled();
    press(document.body, 's'); expect(timeline).toHaveBeenCalledOnce(); expect(editor).not.toHaveBeenCalled();
    remove(); press(document.body, 's'); expect(editor).toHaveBeenCalledOnce();
    keymap.setScopes([]); press(document.body, 's'); expect(editor).toHaveBeenCalledOnce();
  });
  it('accepts Control as Command while preserving native text clipboard and undo', () => {
    const keymap = setup(), run = vi.fn(); keymap.register({ id: 'copy', key: 'c', command: true, scope: 'editor', run });
    press(document.body, 'c', { ctrlKey: true }); expect(run).toHaveBeenCalledOnce();
    const input = document.createElement('input'); document.body.append(input); press(input, 'c', { ctrlKey: true }); expect(run).toHaveBeenCalledOnce();
    press(document.body, 'c', { ctrlKey: true, metaKey: true }); expect(run).toHaveBeenCalledOnce();
  });
  it('leaves shortcuts inside dialogs alone, even global new-goal', () => {
    const keymap = setup(); const run = vi.fn();
    keymap.register({ id: 'new-goal', key: 'n', command: true, scope: 'global', run });
    const dialog = document.createElement('dialog'); dialog.setAttribute('open', ''); const input = document.createElement('input'); dialog.append(input); document.body.append(dialog);
    press(input, 'n', { metaKey: true }); expect(run).not.toHaveBeenCalled();
  });
});
