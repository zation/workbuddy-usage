import type { Filters } from '../shared/types.ts';

export function filterParams(
  filters: Filters,
  extra?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const key of ['from', 'to', 'group', 'session', 'model'] as const) {
    const value = filters[key];
    if (value) {
      params.set(key, value);
    }
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value) {
        params.set(key, value);
      }
    }
  }
  return params.toString();
}

export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        message = body.error;
      }
    } catch {
      // 非 JSON 响应保持状态码提示
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}
