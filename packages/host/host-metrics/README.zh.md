---
description: "面向 Web 控制台的周期主机资源采样器：将 CPU、内存与尽力而为的 GPU 指标作为转发的主机事件发出。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-metrics

[English](README.md) | 中文

## 概述

用于 Web 控制台的周期主机资源采样器。插件按固定间隔读取 CPU 负载与内存占用，并将结果作为转发的主机事件 `host/metrics` 发出，由 Web 控制台的系统状态面板实时渲染。GPU 为尽力而为，在平台适配器提供读数前上报 `null`。

这是一个 host 侧插件：不拥有任何客户端 UI，也不发出 agent 面向事件。`host/metrics` 事件经由共享的 Remote BFF 允许列表转发给每个已连接的主机流，因此浏览器控制台无需专用通道即可订阅。

## 目录

- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

无。采样器发出的主机遥测事件仅供浏览器控制台系统状态面板消费，该指标从不进入模型上下文或会话日志。

#### KV Cache 影响

无；本包既不组装也不发送任何 provider 请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- GPU 利用率恒为 `null`：Node 不暴露跨平台的 GPU 读取，尚未接入适配器。控制台对 `null` 渲染为 N/A。
- CPU 在报告 load average 的平台上按核心数归一化，否则回退为本进程的 user+sys 差值；这是一个粗略的尽力而为数值，并非按核心拆分。
- 内存是整机 used/total 比例，而非 harness 进程自身的工作集。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>
