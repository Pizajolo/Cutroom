import { useCallback, useEffect, useState } from 'react';
import type { InvokeRes } from '@shared/ipc';
import { api } from './api';

export type AppInfo = InvokeRes<'app.getInfo'>;
export function useAppInfo() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const retry = useCallback(() => setRefresh((value) => value + 1), []);
  useEffect(() => {
    let current = true;
    const load = () => {
      void api.invoke('app.getInfo', {}).then((value) => {
        if (current) { setInfo(value); setError(null); }
      }).catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : 'The desktop connection could not be read.');
      });
    };
    load();
    let unsubscribe = () => {};
    try { unsubscribe = api.on('app.ready', load); } catch { /* The load above reports an unavailable bridge. */ }
    return () => { current = false; unsubscribe(); };
  }, [refresh]);
  return { info, error, retry };
}
