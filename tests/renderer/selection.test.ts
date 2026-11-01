import { beforeEach, describe, expect, it } from 'vitest';
import { useSelection } from '../../src/renderer/editor/selection/store';

beforeEach(() => useSelection.getState().clear());

describe('shared editor selection', () => {
  it('distinguishes individual editable elements and caption words within one timeline item', () => {
    const { select } = useSelection.getState();
    select({ itemId: 'composition_0000000001', cutId: 'title-1' });
    select({ itemId: 'composition_0000000001', cutId: 'subtitle-1' }, true);
    select({ itemId: 'caption_0000000002', wordId: 'word-1' }, true);
    expect(useSelection.getState().elements).toHaveLength(3);
    select({ itemId: 'composition_0000000001', cutId: 'title-1' }, true);
    expect(useSelection.getState().elements).toEqual([
      { itemId: 'composition_0000000001', cutId: 'subtitle-1' },
      { itemId: 'caption_0000000002', wordId: 'word-1' },
    ]);
  });
  it('replaces an ordinary selection and clears a previous area', () => {
    const { select, setArea } = useSelection.getState();
    select({ itemId: 'first' }); setArea({ x: 0.2, y: 0.3, w: 0.4, h: 0.2 });
    select({ itemId: 'second' });
    expect(useSelection.getState().elements).toEqual([{ itemId: 'second' }]);
    expect(useSelection.getState().area).toBeNull();
  });
  it('normalises reversed or negative time ranges and clears all selection kinds', () => {
    const { setRange, setArea, clear } = useSelection.getState();
    setRange(5, 2); expect(useSelection.getState().range).toEqual({ start: 2, end: 5 });
    setRange(-3, 4); expect(useSelection.getState().range).toEqual({ start: 0, end: 4 });
    setArea({ x: 0, y: 0, w: 0.5, h: 0.5 }); clear();
    expect(useSelection.getState()).toMatchObject({ elements: [], range: null, area: null });
  });
});
