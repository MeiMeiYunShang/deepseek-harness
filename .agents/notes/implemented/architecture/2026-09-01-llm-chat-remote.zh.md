# Agent Note: LlmRuntime `chat` 流式 Remote，用于一次性补全

Status: implemented

[English](2026-09-01-llm-chat-remote.md) | 中文

## Problem

控制台工作台的 Smart Q&A 面板需要在 web 客户端完成一次性的流式补全。宿主侧的瀑布 `LlmRuntime.stream(options)` 已经服务每一次提供方调用，但它无法通过 Typert Remote 到达：`llm` 命名空间只暴露 `listProviders`、`listConfigurableProviders` 与 `discoverModels`。旧的 apiproxy HTTP/SSE `LlmApi.chat` 路由（provider/model/messages 到 SSE 块）正是新面板所消费的、仅存的缺口，它必须与面板一同落地，以便对消费方做端到端验证。

## Decision

`LlmRuntime` 新增一个 `@Remote({ mode: 'stream' })` 方法，命名为 `chat`：

```ts
@Remote({ mode: 'stream' })
async * chat(request: LlmChatRequest, signal: AbortSignal): AsyncIterable<LlmChatChunk>
```

`chat` 将线上的 `LlmChatRequest` 映射为 `GenerateOptions` 并委托给 `LlmRuntime.stream`，因此适配器解析、`llm/stream` 瀑布、调用配置校验与回放处理仍然生效。映射规则：

- role `user` 映射为 `createUserMessage({ content, source: { kind: 'user' } })`
- role `assistant` 映射为 `createAssistantMessage({ content, source: { provider, model } })`，其来源标注请求的 provider/model
- role `system` 映射为 `GenerateOptions.system`；请求自身的 `system` 字段优先
- 控制项（`temperature`、`maxTokens`、`stop`、`reasoningEffort`）与载体的 `signal` 原样透传

线上结果是精简的 `LlmChatChunk` 联合类型——`text-delta`、`reasoning-delta`、`usage` 与终态的 `finish`——由在边界上对 `StreamChunk` 的投影产生（`block-start`/`block-end`/`tool-call-delta` 被丢弃；可扩展的适配器结束原因退化为终态 `error`）。这是生成器可序列化的 JSON 安全子集。

## Alternatives considered

### 直接复用公开的 `StreamChunk`

已放弃。`StreamChunk` 内嵌 `ContentBlock` 与 `FinishReason`，二者都是可扩展的（`ContentBlockMap`/`FinishReasonMap` 由插件增强）。Typert 生成器拒绝包含不受约束的未知数据的 Remote 边界，因此发布 `AsyncIterable<StreamChunk>` 会使 `build:lib:host` 失败。精简联合类型是生成器合法的投影；面板只渲染文本增量与终态结束。

### 增加把 `ContentBlock` 翻译到线上的块适配器

已放弃。唯一消费方只发送文本块，而忠实的 `ContentBlock` 到线上的映射会继续让生成器卡在同样的可扩展类型上，除非再定义第二套词汇——精简联合类型已经是这套词汇，且没有多余的适配器表面积。

## Consequences

- web 客户端可以通过 `ctx.remote.llm.chat(request)` 流式获得补全，而无需导入可扩展的 ContentBlock 词汇。
- 核心不认识的自定义结束原因会以终态 `error`（`UNKNOWN`）呈现，原因写在 message 文本中。
- `block-start`/`block-end`/`tool-call-delta` 以及 image/reasoning 块不能通过线上表达；控制台面板刻意只处理文本。
