import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { MasterClock, type ClockState } from './clock';

export const previewClock = new MasterClock();
export const clockStore = createStore<ClockState>(() => previewClock.getSnapshot());
previewClock.subscribe((state) => clockStore.setState(state, true));
export function useClock<T>(selector: (state: ClockState) => T): T {
  return useStore(clockStore, selector);
}
