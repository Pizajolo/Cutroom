import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { CutroomApi } from '../shared/types';

declare global {
  interface Window {
    cutroom: CutroomApi;
  }
}
export const api = window.cutroom;

/** 83.4 → "1:23.4" */
export function clock(t: number): string {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

/** Current playback time of a video element, updated every frame while it changes. */
export function useVideoTime(video: RefObject<HTMLVideoElement | null>): number {
  const [time, setTime] = useState(0);
  useEffect(() => {
    let frame = requestAnimationFrame(function tick() {
      setTime(video.current?.currentTime ?? 0);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [video]);
  return time;
}

/** Tell the user why a call to the main process failed, without Electron's "Error invoking remote method" wrapper. */
export const failed = (error: Error): void =>
  alert(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
