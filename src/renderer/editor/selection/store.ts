import { create } from 'zustand';
import type { Bounds } from './pick';

export interface SelectedElement { itemId: string; cutId?: string; wordId?: string }
interface SelectionState {
  elements: SelectedElement[];
  range: { start: number; end: number } | null;
  area: Bounds | null;
  select: (element: SelectedElement, additive?: boolean) => void;
  setRange: (start: number, end: number) => void;
  setArea: (area: Bounds | null) => void;
  clear: () => void;
}
const same = (a: SelectedElement, b: SelectedElement) => a.itemId === b.itemId && a.cutId === b.cutId && a.wordId === b.wordId;
export const useSelection = create<SelectionState>((set) => ({
  elements: [], range: null, area: null,
  select: (element, additive = false) => set((state) => ({
    elements: additive
      ? state.elements.some((entry) => same(entry, element)) ? state.elements.filter((entry) => !same(entry, element)) : [...state.elements, element]
      : [element],
    area: null,
  })),
  setRange: (start, end) => set({ range: { start: Math.max(0, Math.min(start, end)), end: Math.max(0, start, end) } }),
  setArea: (area) => set({ area }),
  clear: () => set({ elements: [], range: null, area: null }),
}));
