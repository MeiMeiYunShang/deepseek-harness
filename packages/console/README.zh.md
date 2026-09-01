# console

[English](README.md) | 中文

将 DeepSeek Harness 桥接到外部**智能体控制台**（agent console）的对外/集成包，基于 DSH 控制台契约。

| Package | Role |
| --- | --- |
| [`console-bridge/`](console-bridge/README.zh.md) | 接收 `down/cmd` 命令，作为 DSH 会话运行，并向控制台回报 `up/cmd/ack` + 终态 `up/result`。 |
