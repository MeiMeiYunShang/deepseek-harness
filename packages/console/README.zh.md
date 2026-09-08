---
description: "智能体控制台集成的包地图：接收控制台指令并将其作为 DSH 会话运行，再把结果回传的命令桥。"
kind: "package-group"
---

# console/ — 智能体控制台集成

[English](README.md) | 中文

## 概要

`console/` 组基于 DSH 控制台契约将 DeepSeek Harness 桥接到外部智能体控制台。桥接收来自控制台的 `down/cmd` 命令，将每条命令作为 DSH 会话运行，并向控制台回报 `up/cmd/ack` 与终态 `up/result`。浏览器端工作台位于 [`packages/client/ui-console`](../client/ui-console/README.zh.md)，组合应用通过 [`apps/cli`](../../apps/cli/README.zh.md) 启动。

## 目录

- [包列表](#packages)
- [相关文档](#related-documentation)
- [开发备忘](#dev-note)

-----

<a id="packages"></a>
## 包列表

| Package | Role |
|---|---|
| [`console-bridge/`](console-bridge/README.zh.md) | 接收 `down/cmd` 命令，作为 DSH 会话运行，并向控制台回报 `up/cmd/ack` + 终态 `up/result`。 |

-----

<a id="related-documentation"></a>
## 相关文档

- [Console bridge 包](console-bridge/README.zh.md) — 将控制台命令作为 DSH 会话运行的后端协议适配器。
- [Host metrics 子系统](../../docs/subsystems/host-metrics.zh.md) — 控制台工作台展示的遥测。

<a id="dev-note"></a>
## 开发备忘

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
