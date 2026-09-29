---
description: "dsh Web 客户端的「内置插件」设置分区：设置导航项与供功能插件注册标签页的标签行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugins

[English](README.md) | 中文

## 概述

使用**内置插件**设置分区查看本部署随附的插件。该分区只是一个壳：它拥有导航项和标签行，里面的每个标签页都由其他插件注册——只读清单注册了一个。配置内置插件在侧栏的插件页上进行，每个官方插件自己的伴生包把页面注册到那里。

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

在设置里打开**内置插件**。[ui-settings-plugin-inventory](../ui-settings-plugin-inventory/README.zh.md) 把清单作为分区唯一的标签页贡献进来，直接显示为页面本身；注册第二个标签页后这一行就变成标签行。组合里没有任何标签页贡献的部署会显示分区的空提示。

要贡献一个标签页，带 `id`、`order` 和本地化的 `label` 注册进 `settings.plugins.tab`；分区按序渲染条目，标签页在首次被选中时挂载。功能文案留在注册方自己的字典里。

**模型价格**卡片记录每条 `(接口地址, 提供方, 模型)` 路由的费用，单位为每百万 token 的货币单位。每条路由都带高峰与低谷两组、每组三个价格 —— 缓存命中输入、缓存未命中输入与输出 —— 因为控制台按某一步所属时段的价格对其 token 计费；缓存写入没有自己的价格，按缓存未命中价格计费。可以就地增删和修改行，一次保存写入整张表；某一行缺少接口地址、提供方或模型，价格缺失或为负，或与另一行使用完全相同的接口地址、提供方和模型时，保存会被拒绝，并指出需要修改的行。空表是正常状态，而不是错误。

### 这里会出现什么

标签页读取 Host 服务了哪些 settings 命名空间，并为每个命名空间派发一个 slot 键，因此渲染出来的是两份账本的交集：存活 Host 插件注册的命名空间，以及注册在这些键上的卡片。被服务却无人认领的命名空间什么都不渲染；命名空间未被本部署服务的卡片根本不会被派发。空态文案要等 Host 的第一次答复，因此一次尚未答复的读取绝不会被读成「本部署没有可配置的插件」。

### 编辑与保存

卡片暂存用户输入，只有用户保存时才写入。每个控件渲染的都是暂存文本，因此屏幕上所见即保存后所存；**放弃修改**丢弃这些草稿，持有未保存修改的卡片即使收起也会在标题上标明。保存成功后，卡片会在回读确认写入后收起；保存失败时，卡片保持展开、报告失败并保留草稿供用户修改。重置暂存的是组装默认值而非立即写入；字段不接受的草稿会阻塞保存，而不是被丢弃。某个值是否被接受只有 Host 说了算。

Subagent 卡会同时暂存其权限开关与精确模型复选框。启用时必须至少选择一条适配器路由。保存会在一次 mutation 中提交 `enabled` 与 `allowedModels`，并以草稿开始时的 revision 设栅；Host revision 更新后，草稿会标记为失败，而不会恢复已撤销的路由。关闭时会保留已选路由供以后重新使用。可用模型按提供方分组；当前目录中缺失的已存路由排在末尾，且仍可移除。适配器名称与模型描述仍属于实时目录元数据，不会存储；适配器变化、设置提交和重连后，卡片会刷新这些元数据。

### secret 角色字段

密钥控件初始为空、只报告是否已配置，并经由 credentials 领域而非 settings 分节写入；空草稿不写入任何东西，保留已存密钥。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

分区声明 `settings.plugins.tab`，一个根级 list slot，其标签成为有序的标签页；只有一个贡献时直接渲染为页面本身，标签页在首次被选中后保持挂载，搜索词和清单快照因此在切换间不丢失。分区的 `inject` 把 slot 账本投影成按序排列、标签随当前语言的行，在账本版本或语言修订变化前保持缓存。宿主半侧是一个空的 `apply`，只为让本包占一条 Loader 行，客户端模块系统据此送出浏览器半侧。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-settings-plugin-inventory](../ui-settings-plugin-inventory/README.zh.md)——只读清单标签页。
- [ui-settings](../ui-settings/README.zh.md)——声明 `settings.section` 的领域基座。
- [ui-plugin-manager](../ui-plugin-manager/README.zh.md)——配置官方插件的插件页。
- [ui-settings-shell](../ui-settings-shell/README.zh.md)、[ui-settings-agent-loop](../ui-settings-agent-loop/README.zh.md)、[ui-settings-subagent](../ui-settings-subagent/README.zh.md)、[ui-settings-web-search](../ui-settings-web-search/README.zh.md)——官方配置页，每个一个伴生包。

-----

<a id="model-experience"></a>
## 模型体验

无，本包是浏览器侧的设置界面，不注册任何模型面。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **分区没有自己的标签页**——在功能插件注册标签页之前它只显示空提示；壳自己填不满分区。
- **运行时不变量：**不发布伴生。分区除了投影 slot 账本之外不拥有任何关系。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
