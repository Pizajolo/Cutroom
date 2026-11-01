import { useSyncExternalStore } from 'react';

// One subscription per resource, shared by every mounted consumer. Events win over
// older fetches, including fetch failures and replies from an earlier mount.
export function createLiveResource<T>(load: () => Promise<T>, listen: (receive: (value: T) => void) => () => void, fallback: string) {
  const empty = { data: null as T | null, error: null as string | null };
  let snapshot = empty;
  let revision = 0;
  let unsubscribe: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const notify = () => { listeners.forEach((listener) => listener()); };
  const write = (data: T) => { revision++; snapshot = { data, error: null }; notify(); };
  const reload = async () => {
    const version = ++revision;
    try {
      const data = await load();
      if (version === revision) write(data);
    } catch (reason: unknown) {
      if (version === revision) {
        snapshot = { ...snapshot, error: reason instanceof Error ? reason.message : fallback };
        notify();
      }
    }
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (listeners.size === 1) {
      try {
        unsubscribe = listen(write);
        void reload();
      } catch (reason: unknown) {
        snapshot = { ...snapshot, error: reason instanceof Error ? reason.message : fallback };
        notify();
      }
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size) { unsubscribe?.(); unsubscribe = undefined; revision++; snapshot = empty; }
    };
  };
  return {
    useResource: () => ({ ...useSyncExternalStore(subscribe, () => snapshot), retry: reload }),
    revision: () => revision,
    update: (transform: (data: T) => T, expectedRevision: number) => {
      if (revision === expectedRevision && snapshot.data !== null) write(transform(snapshot.data));
    },
  };
}
