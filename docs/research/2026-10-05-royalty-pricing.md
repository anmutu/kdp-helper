# KDP 平装版税（美区）与定价试算

访问日期：**2026-10-05**。来源：[官方版税计算页（G201834330）](https://kdp.amazon.com/en_US/help/topic/G201834330)。仅 amazon.com 美区、平装。

## 公式与断点

公式（官方原文）：`(Royalty rate x list price) – printing costs = royalty`

| 定价（美区） | 版税率 |
| ------------ | ------ |
| ≤ $9.98      | 50%    |
| ≥ $9.99      | 60%    |

- **断点是定价决策的关键**：一本 26 页黑白绘本（印刷成本 $2.84），定价 $9.98 版税 $2.15，定价 $9.99 版税 $3.15——多 1 美分定价、每册多约 1 美元版税。
- 扩展分销（Expanded Distribution）：40% × 定价 − 印刷成本。
- 平装无电子书式的配送费，只减印刷成本。
- 促销折扣不减少作者版税（按定价计算）。

## 工具内的实现与边界

- 纯函数 `royaltyEstimate(config, pageCount, listPrice)`（`src/domain/print-spec.ts`），印刷成本复用 `printingCostEstimate`（Large trim 档，见 `2026-09-18-printing-cost.md`）。
- `listPrice` 为书本可选字段（作者试算用，不代表实际上架价）；落在 $9.00–9.98 时界面主动提示 $9.99 断点收益。
- 导出说明（upload-notes.txt）联动输出印刷成本与版税试算行，注明「以 KDP 结算为准」。
- 不做的事：不代表 KDP 结算（税费、退款、其他市场费率未覆盖）；只做美区 amazon.com 口径，其他市场（.co.jp 等）费率不同，需要时另行核对官方页后再加。
