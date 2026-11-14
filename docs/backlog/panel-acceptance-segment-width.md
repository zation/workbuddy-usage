# 交互验收 AC4 分组条段宽之和超出容差

## 背景

`npm run acceptance` 的既有验收项「AC4 分组条按模型分段，段色与趋势图逐值一致，段宽之和等于原条宽」在当前 headless Chrome 下稳定失败，与 `deepseek-price-ratio` 交付无关（分组条分段属 `time-range-group-split` 交付）。

## 问题

- 断言为 `Math.abs(widthsSum - expectedWidth) <= 1.5`，其中 `expectedWidth = tokenShare × barWidth`。
- 实测（2026-11-14，macOS / Chrome 157 / 1400×1100 / deviceScaleFactor 1）：7 个分段宽度之和 224.9px，期望 222.7px，差 2.2px；段数与段色逐值一致。
- 在修改本轮任何代码之前跑基线即以相同数值失败，两次复现一致，因此不是本轮改动引入的回归。

## 已知约束

- 不得通过调大容差、删除断言或跳过该验收项让检查变绿（AGENTS.md 第 4 节「不得为了通过检查而删除测试、降低校验标准或隐藏错误」）。
- 需先定位差值来源：分段百分比的布局舍入、`border` / `gap` 是否计入 `getBoundingClientRect().width`，以及 `tokenShare` 与条容器宽度的基准是否一致；确认是断言基准问题还是渲染缺陷后再决定改哪一侧。

## 预期价值

验收脚本恢复全绿，避免每次交付都带一个无法归因的既有失败项。

## 待确认问题

- 差值是否随分段数量线性增长（当前 7 段 / 2.2px）。
- 是否只在 headless Chrome 出现，有头浏览器与不同 deviceScaleFactor 下的表现。
