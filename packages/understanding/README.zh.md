---
description: "理解能力家族：面向文本型模型的图片转文本，使没有视觉能力的模型仍能处理已受理的图片提示词。"
kind: "package-group"
---

# understanding/ — 理解能力家族

[English](README.md) | 中文

## 概述

理解组把已受理图片桥接为文本供文本型模型使用。`image-understanding` 提供 `ctx.imageToText` 接缝，并在 `agent/pre-step` 通过可插拔识别后端（Zhipu 免费视觉 API、本地 Ollama、Windows 系统 OCR）翻译图片块，信任图片能力路由原样接收图片，并在失败时恢复提示词。它依赖持久图片库（`dsh-attachment`）与模型目录响应（`dsh-llm`）。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`image-understanding`](image-understanding/README.zh.md) | 面向文本型路由的图片转文本；注册 `agent/pre-step` 翻译钩子 | 提供 `ctx.imageToText` |

-----

<a id="related-documentation"></a>
## 相关文档

- [附件子系统](../../docs/subsystems/attachment.zh.md)——接缝所读取的持久归一化图片库。
- [Web 客户端架构](../../docs/subsystems/web-client.zh.md)——模型面向路径所基于的文本型图片投影。

<a id="dev-note"></a>
## 开发备注

无。
