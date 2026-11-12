import { useEffect, useState } from 'react';

export function App() {
  const [health, setHealth] = useState<string>('检测中');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: { ok: boolean }) => setHealth(data.ok ? '正常' : '异常'))
      .catch(() => setHealth('未连接'));
  }, []);

  return (
    <main className="shell">
      <h1>WorkBuddy 用量统计</h1>
      <p>API 状态：{health}</p>
    </main>
  );
}
