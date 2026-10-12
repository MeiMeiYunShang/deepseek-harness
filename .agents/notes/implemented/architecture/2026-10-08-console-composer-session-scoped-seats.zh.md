# Agent Note: 控制台输入框复用聊天的权限与模型座位

Status: implemented

[English](2026-10-08-console-composer-session-scoped-seats.md) | 中文

## Problem

控制台工作台底部的输入框只渲染了一个文本框与一个发送操作，而它旁边的聊天输
入框提供三个控件：权限选择、模型选择，以及 `+` 添加文件 / 调用指令按钮。操作
者询问控制台为何不能携带同样的控件。答案因控件而异，而这个区别是一条架构不
变量，而非样式缺口。

## Decision

**会话作用域的服务投影可以经第二个座位跨界面复用。** 权限与模型是每个会话
服务的纯投影 —— 一个当前值与一个选择动作 —— 与输入文档无关。控制台声明两个
新的会话作用域座位 `console.input.permission` 与 `console.input.model`，由它
渲染，而填入聊天座位的同样归属包（`ui-permission-presets`、
`ui-model-selection`）也填入它们：一个组件、一份 inject 面、一个 locale 命名
空间，注册在第二个键下。控制台保留自己的文本框；它把座位包在
`SessionProvider` 中，透过一个以 `console` 为来源的 `SessionReference` 绑定，
且只有当该会话的 binding 已处于活动状态时才 retain，因此选中一个会话来查看
不会自行发起 open。座位恰好在输入框共享的输入机未就绪时被锁定。

**输入文档类附加功能不可复用，因为每个会话只拥有一个编辑器。** `+` 控件、
它的文件附件，以及 `@` 提及与斜杠指令浮层，都与每会话的 shell 编辑器不可分
离：`addFiles` 把文件引用写入编辑器文档，指令菜单锚定在编辑器光标，`@`/`/`
是文档内装饰，全都绑定到 `ComposerContentEditable` 经 `setRootElement` 独占
的唯一 Lexical 根。控制台通过整文档 `setDraft` 驱动同一台机器，因此为该会话
再挂一个编辑器或注入 chip 会与聊天视图的编辑器争抢。要达到完整对等，必须让
控制台成为该会话独占的输入框，同时聊天视图不再渲染自己的输入框 —— 这是一个
独立的所有权决策（Route 1），本注记不予采纳。

**非 keyed 座位不嵌入键字面量，因此一个组件可服务多个座位。** `KeyPropsOf`
对 `kind: 'single'` 的槽解析为 `object`，所以
`PropsRuntime<'conversation.input.permission'>` 不携带座位键字符串，与
`PropsRuntime<'console.input.permission'>` 结构等同。因此注册点的协变标记允许
同一组件在第二个键下注册，无需把它的 props 泛化为键联合或加一层包装。

**座位类型与聊天孪生一起 home 在 `ui-conversation`。** 两个填手包与控制台都
已 type-only 依赖 `ui-conversation` 的 composer 契约，所以把 `console.input.*`
的类型放在此处不新增依赖边、不成环；若改为在 `ui-console` 声明，则会从每个填
入包逼出一条对控制台的新依赖边。

## Amendment（经批准的后续：纯文本指令与附件面）

一次后续改动经操作者批准，以 **一级纯文本降级**（而非 Route 1）反转了上文的
「仅聊天」边界。控制台输入框现在携带 `+` 启动器、内联 `/` 指令菜单、内联 `@`
文件菜单与草稿附件轨。复用完全落在 submit 平面上，因此单编辑器不变量不受影响：
选中的指令以 `/name ` 文本插入，由同一台 shell 机在 Enter 时判定（其 `onEnter`
在 trimmed 草稿以 `/` 开头时触发），图片或文件经由 `SessionInput` 的
`addAttachments`/`removeAttachment` 与对话归属者的草稿附件 intake 进入，该
intake 现已作为可选成员暴露在 `IConversation` 上（`createDrafts`/
`resolveDraftAttachments`/`retryFileUpload`/`releaseDraftAttachment`/`fileUploads`），
因此控制台经会话作用域即可触及，且不新增依赖边。候选来自
`ctx.remote.commands.list`、`ctx.remote.skills.list` 与
`ctx.remote.fileReferences.list`，装配在控制台本地的 `ComposerMenu` 中，复用
`MenuSurface` 原语与 `rankByName`，但不使用聊天共享的 `inputTriggers` 控制器。
控制台仍驱动聊天的 textarea 且从不调用 `setRootElement`，因此独占约束成立：真正
需要编辑器文档的两项附加功能不复现 —— `@` 提及以字面 `@path` 文本而非 chip
到达，指令的参数 popup 也不重建 —— 工作区选择亦不纳入。聊天与控制台现为同一
会话共享一份草稿与一组附件，经共享机器保持同步。

## Alternatives considered

**把组件 props 泛化为两键联合或加包装。** 拒绝，因为 single 座位不把键烘进
props，普通组件在第二个座位下本就能通过类型检查。

**把座位类型 home 在 `ui-console`。** 拒绝，因为它会从两个已共享聊天 composer
契约的包新增一条对控制台的 type-only 依赖。

**只要控制台选中某会话就 retain 一个引用。** 拒绝，因为 retain 会发起 open，
而控制台是一面监控镜像，不得激活操作者仅浏览的会话。

**在同一次改动里交付 `+` 控件。** 拒绝，因为它绑定于每会话单编辑器不变量，
需要 Route 1 的独占输入框所有权，是需另行批准的更大决策。

## Consequences

- 控制台的 sidebar 入口声明三个子座位（任务统计动作加两个会话作用域输入座
  位）；两个会话座位交给该入口一个 `SessionProvider` 与一个收窄到这些键的
  `renderSlot`。
- 权限与模型在聊天与控制台之间仍是同一归属者：未来对任一控件的改动都会经共享
  组件同时抵达两个界面。
- 附件、`@`/`/` 与工作区控件在上述改动落地前仍只属于聊天侧；上述改动以纯文本
  降级落地了指令、提及与附件面，而工作区选择，以及需要编辑器的富 chip 与参数
  popup 行为仍只属于聊天侧。
