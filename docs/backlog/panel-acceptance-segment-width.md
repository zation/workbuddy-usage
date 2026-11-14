# 多分段行的段宽累计舍入

## 背景

旧的自研 CDP 验收脚本里，「分组条段宽之和等于原条宽」一项曾稳定失败：7 个分段时宽度之和 224.9px、期望 222.7px，差 2.2px（2026-11-14，headless Chrome / 1400×1100 / deviceScaleFactor 1），与当时的交付无关。该脚本已在 `hover-model-focus` 交付中退役。

## 现状

交互验收改用 Playwright 与固定样本后，同一判定标准（`|段宽之和 − 主指标占比 × 条宽| ≤ 1.5px`）在 `tests/e2e/breakdown.spec.ts` 中通过；但样本首行只有 4 个分段，**没有覆盖 7 段以上的场景**，上述累计舍入是否仍然存在未复测。

## 待确认问题

- 差值是否随分段数量线性增长；若会超过 1.5px，来源是百分比布局舍入，还是 `border` / 段间距被计入 `getBoundingClientRect().width`。
- 复测方式：给 `tests/e2e/sample.ts` 的分组样本加一行 7 个以上模型的请求，再跑 `npm run acceptance tests/e2e/breakdown.spec.ts`。

## 预期价值

分段数量多的真实分组不会因为断言基准问题反复触发失败；若确认是渲染缺陷，再决定改布局还是改断言基准。
