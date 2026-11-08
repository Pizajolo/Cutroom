export interface ClockState {
  time: number;
  duration: number;
  fps: number;
  rate: number;
  playing: boolean;
  loop: { start: number; end: number } | null;
}
export interface ClockScheduler {
  now: () => number;
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
}
const browserScheduler: ClockScheduler = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
};

/** The clock is authoritative; media elements follow it, never the other way around. */
export class MasterClock {
  private state: ClockState = { time: 0, duration: 0, fps: 30, rate: 1, playing: false, loop: null };
  private listeners = new Set<(state: ClockState) => void>();
  private anchorTime = 0;
  private anchorWall = 0;
  private frame: number | null = null;
  private scheduler: ClockScheduler;

  constructor(scheduler: ClockScheduler = browserScheduler) {
    this.scheduler = scheduler;
  }

  getSnapshot = (): ClockState => this.state;
  subscribe = (listener: (state: ClockState) => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  configure(duration: number, fps: number): void {
    if (!Number.isFinite(duration) || duration < 0 || !Number.isFinite(fps) || fps <= 0) throw new Error('Invalid clock format');
    this.sample();
    const loop = this.state.loop;
    this.update({ duration, fps, time: Math.min(this.state.time, duration), loop: loop && loop.start < duration ? { start: loop.start, end: Math.min(loop.end, duration) } : null });
    this.anchor();
    if (!duration) this.pause();
  }

  setLoop(range: { start: number; end: number } | null): void {
    this.sample();
    const start = range ? Math.max(0, Math.min(range.start, range.end)) : 0;
    const end = range ? Math.min(this.state.duration, Math.max(range.start, range.end)) : 0;
    if (range && (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)) throw new Error('Invalid loop range');
    this.update({ loop: range ? { start, end } : null });
    this.anchor();
  }

  play(rate = this.state.rate): void {
    if (!Number.isFinite(rate) || !rate || Math.abs(rate) > 16) throw new Error('Invalid playback rate');
    if (!this.state.duration) return;
    this.sample();
    let time = this.state.time;
    if (this.state.loop) {
      if (time < this.state.loop.start || time >= this.state.loop.end) time = this.state.loop.start;
    } else {
      if (rate > 0 && time >= this.state.duration) time = 0;
      if (rate < 0 && time <= 0) time = this.state.duration;
    }
    this.update({ playing: true, rate, time });
    this.anchor();
    this.schedule();
  }

  pause(): void {
    this.sample();
    this.update({ playing: false });
    this.cancelFrame();
  }

  toggle(): void { if (this.state.playing) this.pause(); else this.play(); }

  seek(time: number): void {
    if (!Number.isFinite(time)) return;
    this.update({ time: Math.max(0, Math.min(this.state.duration, time)) });
    this.anchor();
  }

  step(frames: number): void {
    this.pause();
    this.seek((Math.round(this.state.time * this.state.fps) + frames) / this.state.fps);
  }

  shuttle(direction: -1 | 1): void {
    const { playing, rate } = this.state;
    const next = playing && Math.sign(rate) === direction ? Math.min(4, Math.abs(rate) * 2) : 1;
    this.play(direction * next);
  }

  dispose(): void {
    this.cancelFrame();
    this.update({ playing: false });
    this.listeners.clear();
  }

  private anchor(): void {
    this.anchorTime = this.state.time;
    this.anchorWall = this.scheduler.now();
  }
  private update(patch: Partial<ClockState>): void {
    if (Object.entries(patch).every(([key, value]) => this.state[key as keyof ClockState] === value)) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
  private sample(): void {
    if (!this.state.playing) return;
    const time = this.anchorTime + (this.scheduler.now() - this.anchorWall) / 1000 * this.state.rate;
    const loop = this.state.loop;
    if (loop) {
      const span = loop.end - loop.start;
      this.update({ time: loop.start + ((time - loop.start) % span + span) % span });
      return;
    }
    const finished = time >= this.state.duration || time <= 0 && this.state.rate < 0;
    this.update({ time: Math.max(0, Math.min(this.state.duration, time)), ...(finished ? { playing: false } : {}) });
    if (finished) this.cancelFrame();
  }
  private schedule(): void {
    if (this.frame !== null || !this.state.playing) return;
    this.frame = this.scheduler.request(() => {
      this.frame = null;
      this.sample();
      this.schedule();
    });
  }
  private cancelFrame(): void {
    if (this.frame !== null) this.scheduler.cancel(this.frame);
    this.frame = null;
  }
}
