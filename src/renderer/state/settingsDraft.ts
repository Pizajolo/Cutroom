import { create } from 'zustand';
interface DraftGuard {
  save: () => Promise<boolean>;
  discard: () => void;
  preview: unknown;
}
export const useSettingsGuard = create<{ guard: DraftGuard | null; pending: (() => void) | null; busy: boolean }>(() => ({ guard: null, pending: null, busy: false }));
export function requestNavigation(action: () => void) {
  if (useSettingsGuard.getState().guard) useSettingsGuard.setState({ pending: action });
  else action();
}
