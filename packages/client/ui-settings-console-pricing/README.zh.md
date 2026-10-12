---
description: "dsh Web 客户端插件页上的模型价格页：每条模型路由一行，记录其高峰与低谷价格，数据来自 console-bridge 命名空间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-console-pricing

[English](README.md) | 中文

## 概述

在侧栏打开**插件**并选择**模型价格**，即可记录每条 `(baseUrl, provider, model)` 路由每百万 token 的价格：每条路由一行，分别填写高峰与低谷时段下缓存命中输入、缓存未命中输入和输出的价格。控制台任务统计与对话单轮费用读取的正是这张表。任务统计卡片头部的**费用设定**在控制台之上打开同一张表，让未定价的费用就地得到修正。这两处界面仅在 Host 服务 `console-bridge` 命名空间且本插件加载期间存在：停用插件，页面与控制台入口一同消失。

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

官方分组里的**模型价格**卡片打开这一页。**添加模型路由**新增一行；每行先填接入地址、提供方标识和模型标识，再在**高峰**与**低谷**下分别填写**缓存命中输入**、**缓存未命中输入**和**输出**三项价格。价格以每百万 token 的货币单位计，货币由运营者自己记账时决定；页面写明单位，不存储货币符号。没有对应行的路由会显示为未定价，这与「免费模型」不是同一件事。

点击**保存**之前不会写入任何内容，而一次保存会替换整张表，因此删掉的行是真的被删除。检查不通过的表会原样留在屏幕上，并指出需要修改的那一行：接入地址、提供方或模型为空，价格不是不小于 0 的数字，或两行使用了相同的接入地址、提供方和模型，都会阻止保存并标出对应单元格。部署没有接受的保存会保留这些行供修改，离开页面则丢弃草稿。

任务统计卡片头部的**费用设定**在控制台之上打开这张表。卡片费用没能计入某条路由时，弹窗按原因逐条列出这些路由的提供方和模型 —— 没有价格行，或者同一条路由被多行定价 —— 因此要补哪一行是被点名说出的，而不是只报一个数量。弹窗自己暂存草稿，因此不保存就关闭只会丢弃弹窗暂存的内容，插件页的草稿原样保留。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

宿主半侧是一个空的 `apply`，只为让本包占一条 Loader 行，客户端模块系统据此送出浏览器半侧。浏览器半侧通过 `ctx.configForms.get` 绑定 `console-bridge` 命名空间——命名空间常量取自 `ui-primitives`，那是所有客户端费用读取方共用的唯一来源——用 `ConsolePricingCardController` 暂存整张表，并通过 `ctx.configForms.whileServed` 把 `ConsolePricingCard` 注册进插件页的 `plugins.item` slot：Host 服务该命名空间期间注册，停止服务时注销。暂存的是一整个列表值，共享的 `SettingsFormModel` 的逐字段规格并不建模这种值，因此控制器自己持有草稿，并把它作为一次带修订栅栏的 `models` 操作写入；`SettingsForm` 框架的文案以 props 传入，页面自己的文案在本包的 `settings.consolePricing` 字典里。

同一个类的两个控制器分别服务两处界面，各随一次 `whileServed` 注册，因此弹窗的 `SettingsForm` 只丢弃弹窗自己暂存的草稿。表体是 `PriceTable`，两处界面都在自己的框架里渲染它。`ConsolePricingEntry` 通过 `ctx.slots.inject` 注册进 `console.task-stats.action`——由 `ui-console` 自己声明的动作区——声明存在时执行一次，控制台重新挂载时再次执行。卡片把自己作用域内的路由桶和自己计价的价格表交给那个座位；入口用 `totalCost` 读它们，按原因逐条点名这张表没能计费的路由，而 `ui-console` 不知道入口如何处理这些数据。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-plugin-manager](../ui-plugin-manager/README.zh.md)——插件页以及本页注册进去的 `plugins.item` slot。
- [ui-settings](../ui-settings/README.zh.md)——本页暂存所依据的配置表单，以及所依赖的「命名空间被服务期间」的监视。
- [ui-primitives](../ui-primitives/README.zh.md)——共享的设置表单框架与命名空间常量。
- [console-bridge](../../console/console-bridge/README.zh.md)——注册 `console-bridge` 命名空间并校验已存价格表的插件。
- [ui-console](../ui-console/README.zh.md)——控制台工作台，其任务统计卡片读取本表得出费用，并声明本包入口注册进去的动作区。

-----

<a id="model-experience"></a>
## 模型体验

无，本包是浏览器侧的设置界面，不注册任何模型面。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **一个宿主命名空间一个页面**——本页只编辑 `console-bridge` 的 `models` 字段。命名空间的其余部分（控制台身份、传输方式、broker 与控制台地址、凭据，以及每个任务的 Agent、模型、工作目录与各类间隔）目前仍没有界面；为它做的页面应放在本包，或作为同一命名空间的相邻页面。
- **低谷时段窗口没有编辑器**——`offPeak`（start、end 与 timezone）决定每条路由的 token 落在哪个时段的价格上。它是在某个 IANA 时区里的墙钟窗口而不是价格，需要单独的控件；在它出现之前，窗口缺失意味着所有时段都按高峰价格计费。
- **运行时不变量：**不发布伴生。本页没有自己拥有的关系：它显示的内容派生自设置镜像，它写入的内容由 Host 校验。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
