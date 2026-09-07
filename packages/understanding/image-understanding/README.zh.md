---
description: "面向文本型模型的图片转文本：可插拔识别后端（Zhipu 免费视觉 API、本地 Ollama、Windows 系统 OCR）在 agent/pre-step 把图片块改写为有界文本，对原生视觉路由透传，并在失败时回退恢复。"
kind: "package-reference"
---

# @deepseek-ai/dsh-image-understanding

[English](README.md) | 中文

## 概述

`dsh-image-understanding` 让文本型模型能够处理携带图片的已受理提示词。在 `agent/pre-step` 它会检查 agent 组合路由是否支持图片；对文本型路由，它把每张图交给所选识别后端，并把图片块替换为有界识别文本。原生视觉路由则原样透传。当识别失败时，插件把所有已认领的消息恢复到 `next-turn` 收件箱，并追加一条可持久化的 `user/image-understanding-failed` 通知，因此提示词保持待处理，供用户编辑、移除图片或重发，而不是静默降级。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把 `image-understanding` 与知识图片路径和 `llm` 服务一同挂载。配置 `backend`（`zhipu` | `ollama` | `windows`）、`maxTextChars`、`timeoutMs` 以及后端相关的 `zhipu`/`ollama` 设置。后端按平台默认：Windows 到无密钥的系统 OCR，其他主机到本地 Ollama。

### source 提供什么

插件提供 `ctx.imageToText` 接缝（一个 `ImageToText` 实现）并注册 `agent/pre-step` 钩子。来自消息自身文本的每次调用 `prompt` 会作为 API 变体的视觉指令；空指令则使用配置的默认值。结果受 `maxTextChars` 约束。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包拥有 `ImageToText` Service Definition 角色（在 `dsh-attachment` 中声明）：`describe(ref, signal, prompt)` 为一张持久图返回有界文本。后端位于 `backends.ts`——一次 Zhipu OpenAI 兼容 chat-completions 调用、一次 Ollama `/api/chat`、以及一个 PowerShell `Windows.Media.Ocr` 驱动（其输入经 `sharp` 归一化为 PNG）。`resolveConfig` 是唯一显式解析步：按平台默认选择后端，并对在非 Windows 主机选择 `windows` 做 fail-loud 校验。`ImageUnderstandingService` 按内容地址+提示词缓存，并把超时/附件读取/传输失败归类为稳定错误码。

### 注册

`apply` 注册服务接缝与 `agent/pre-step` 钩子。钩子经 `agent.options.provider/model` 与 `ctx.llm.resolveModelInfo(...).inputModalities` 解析组合路由；包含 `image` 的路由直接调用 `next()`。否则钩子翻译图片，并在任何失败时重新排队并发出可持久化失败事件。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-attachment](../../attachment/attachment/README.zh.md)——持久图片库与 `ImageToText` 接缝。
- [dsh-llm](../../llm/llm/README.zh.md)——`contentHasImage`、`resolveModelInfo` 与文本型图片投影回退。
- [dsh-session](../../core/session/README.zh.md)——`user/image-understanding-failed` 与 `knowledge/summary-llm-request` 日志事件。

-----

<a id="model-experience"></a>
## 模型体验

### 对文本型路由将图片提示投影为文本

#### 模型看到的内容

对文本型路由，每个图片块被替换为有界的 `[图片N 识别内容]\n<text>` 文本块，其中文本来自 `ctx.imageToText.describe(...)`。消息自身的用户文本（如"红色方框里是什么？"）作为 API 后端的视觉指令，因此视觉模型回答用户的问题，而非运行固定 OCR 指令。对图片能力路由，插件无操作：调用 `next()`，模型原样收到图片。

#### Token 影响

识别文本以请求成本加入用户内容；文本型路由不发送图片字节本身。配置的 `maxTextChars` 约束每个替换。

#### KV Cache 影响

识别文本是提示词内的替换，属于请求 token；本插件绝不改写较早历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是当前包约束。

- **后端需要可达的 Zhipu/Ollama 端点或 Windows OCR 引擎**——免费视觉 API 与本地 Ollama 服务超出 harness 控制；不可用时插件退化为失败-恢复路径。
- **Windows OCR 引擎在非 Windows lane 未测试**——其 spawn 驱动由模拟子进程验证；真实引擎的语言可用性取决于用户配置文件。
- **路由检查读取 agent 组合，而非逐轮模型选择**——与 `agent.options` 不同的逐轮覆盖无法在此边界读取；不可解析或模糊的路由会被保守翻译（内置的文本型投影覆盖残余情形）。
- **设置卡片已延期**——旧的主机设置命名空间（`installSettingsSection`）在当前仓库不存在，因此后端/限制通过 cordis.yml 配置，而非 Web Settings 分区。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
