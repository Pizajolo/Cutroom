import { describe, expect, it } from 'vitest';
import { MasterClock, type ClockScheduler } from '../../src/renderer/editor/preview/clock';
import { formatTimecode, parseTimecode } from '../../src/renderer/lib/time';

function fixture() {
  let now = 0; let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const scheduler: ClockScheduler = { now: () => now, request: (callback) => { callbacks.set(++nextId, callback); return nextId; }, cancel: (id) => { callbacks.delete(id); } };
  const clock = new MasterClock(scheduler);
  clock.configure(20, 30);
  return { clock, advance: (milliseconds: number) => { now += milliseconds; const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach((callback) => callback(now)); }, callbacks };
}

describe('master clock', () => {
  it('anchors to wall time instead of accumulating rAF jitter', () => {
    const { clock, advance } = fixture(); clock.play();
    for (const sample of [4001, 3995, 4007, 3990, 4007]) advance(sample);
    expect(clock.getSnapshot().time).toBe(20); expect(clock.getSnapshot().playing).toBe(false);
  });
  it('pauses, seeks and resumes without including paused wall time', () => {
    const { clock, advance } = fixture(); clock.play(); advance(1500); clock.pause(); advance(5000);
    expect(clock.getSnapshot().time).toBe(1.5);
    clock.seek(7); clock.play(); advance(1000); expect(clock.getSnapshot().time).toBe(8);
  });
  it('shuttles at 1×, 2×, 4× and reverse time never runs past zero', () => {
    const { clock, advance } = fixture(); clock.shuttle(1); expect(clock.getSnapshot().rate).toBe(1);
    clock.shuttle(1); expect(clock.getSnapshot().rate).toBe(2); advance(1000); expect(clock.getSnapshot().time).toBe(2);
    clock.shuttle(1); expect(clock.getSnapshot().rate).toBe(4); clock.shuttle(-1); expect(clock.getSnapshot().rate).toBe(-1);
    advance(3000); expect(clock.getSnapshot()).toMatchObject({ time: 0, playing: false });
  });
  it('steps exactly one output frame and cancels outstanding callbacks on dispose', () => {
    const { clock, callbacks } = fixture(); clock.seek(5); clock.step(1); expect(clock.getSnapshot().time).toBe(151 / 30);
    clock.step(-1); expect(clock.getSnapshot().time).toBe(5); clock.play(); expect(callbacks.size).toBe(1); clock.dispose(); expect(callbacks.size).toBe(0);
  });
  it('refuses invalid configurations and playback rates', () => {
    const { clock } = fixture(); expect(() => clock.configure(-1, 30)).toThrow(); expect(() => clock.configure(10, 0)).toThrow(); expect(() => clock.play(0)).toThrow(); expect(() => clock.play(Infinity)).toThrow();
  });
});

describe('frame timecode', () => {
  it('round-trips actual frame indices for fractional frame rates', () => {
    for (const fps of [23.976, 24, 29.97, 30, 60]) for (const frame of [0, 1, 59, 1499, 18001]) {
      expect(parseTimecode(formatTimecode(frame / fps, fps), fps)).toBeCloseTo(frame / fps, 8);
    }
  });
  it('rejects invalid seconds and frame fields', () => {
    expect(parseTimecode('1:60.00', 30)).toBeNull(); expect(parseTimecode('0:05.30', 30)).toBeNull(); expect(parseTimecode('five', 30)).toBeNull();
  });
});
