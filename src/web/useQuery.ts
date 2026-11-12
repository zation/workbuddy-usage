import { useEffect, useState } from 'react';
import { fetchJson } from './api.ts';

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** 按 URL 拉取一次 API 数据；path 变化或 deps 变化时重新请求。 */
export function useQuery<T>(path: string, deps: readonly unknown[] = []): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;
    setState((previous) => ({ data: previous.data, loading: true, error: null }));
    fetchJson<T>(path)
      .then((data) => {
        if (active) {
          setState({ data, loading: false, error: null });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            data: null,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [path, ...deps]);

  return state;
}
