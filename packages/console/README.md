# console

English | [中文](README.zh.md)

Outbound/integration packages that bridge DeepSeek Harness to an external **智能体控制台**
(agent console) over the DSH console contract.

| Package | Role |
| --- | --- |
| [`console-bridge/`](console-bridge/README.md) | Accept `down/cmd` commands, run each as a DSH session, and report `up/cmd/ack` + terminal `up/result` back to the console. |
