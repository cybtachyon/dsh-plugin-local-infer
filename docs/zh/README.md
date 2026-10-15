# dsh-plugin-local-infer

> 本中文翻译由 Qwen3.8-27B 生成。欢迎提交 Pull Request 改进翻译。

> 面向那些希望从特定硬件中获得比 Unsloth 开箱即用更高性能的用户。

一个 DeepSeek Harness 插件，用于管理本地推理引擎：

- llama.cpp
- NInfer
- Hyper-Qwen (vLLM)
- Strata
- ...更多即将推出。

![插件截图](../screenshot-20261014.png)

选择一个模型和引擎，调节参数，实时观察 **VRAM 估算** 仪表，当某个值（或参数本身）对检测到的硬件不安全时立即看到 **硬件警告**，随后该插件会管理每个引擎的 **构建、部署和健康检查**，并在确认其正常工作后 **自动将其注册为 DSH 模型**。无需手动编辑易出错的 yaml 或启动器。

## 安装

命令行：

```bash
dsh plugin --profile web add https://github.com/cybtachyon/dsh-plugin-local-infer
```

Web UI：点击 **插件** → **添加插件** → 粘贴 `https://github.com/cybtachyon/dsh-plugin-local-infer`。

## 使用插件

**引擎设置** 卡片挂载在插件页面（旧版本主机：设置页面）。

- **选择引擎和模型**，然后调节参数。每个字段根据其类型渲染：复选框、下拉框、滑块、文本、目录选择器，以及一个聊天模板组合框（已知模板加上自由文本）。
- **观察 VRAM 估算仪表。** 当你调整值时，它根据你的显卡对权重、KV 缓存、开销和工作区进行估算，并显示判定结果（`fits` / `tight` / `over`）以及能容纳的最大上下文。
- **阅读警告。** 当某个参数值，或某个参数的存在，对你的检测到的硬件不安全时，红色横幅和内联字段警告会触发。
- **满足系统依赖项。** 面板列出每个缺失的主机依赖项（docker、CUDA toolkit、ffmpeg、hf CLI、...），并附有其用途、针对你操作系统的复制粘贴安装字符串，以及可选的一键 **运行**（sudo）。**获取** 按钮在所有依赖项报告满足之前保持禁用状态。
- **启动 / 停止。** `启动` 克隆或拉取引擎、下载模型、启动它，并轮询其健康端点。`停止` 将其关闭。
- **注册 / 移除。** `注册` 通过设置服务将确认工作正常的引擎作为模型发布到 DSH（可选地作为代理默认模型），因此该变更可被修订跟踪并可撤销。`移除` 将该条目拉回。

所有值都持久化到 `~/.dsh/local-infer/config.json`；浏览器永远不会看到它未存储的值。

## 支持的平台

### 操作系统

| 操作系统                     | 状态     | 说明                                                                                                      |
| ---------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| Linux (Debian/Ubuntu, `apt`) | 已支持   | 安装块镜像可用的 NInfer 启动器：CUDA keyring 序列加上编译工具链。                                         |
| Linux (Arch, `pacman`)       | 已支持   | `pacman` 块加上 `/opt/cuda` 导出行。                                                                      |
| Linux (Fedora, `dnf`)        | 未测试   | 命令集已存在，在实时主机上标记为未测试。                                                                  |
| macOS (`brew`)               | 部分支持 | CPU/docker 路径（llama.cpp）。macOS 上没有 NVIDIA Container Toolkit，因此 CUDA 引擎的 docker 路径不可用。 |
| Windows (WSL2)               | 未测试   | WSL2 被检测，dflash2 固定内存规则触发；命令集标记为未测试。                                               |
| Windows                      | 部分支持 | 代码路径仅部分编写；需要进一步开发。                                                                      |

### 引擎

| 引擎              | Docker       | 本地构建          | 状态                                               |
| ----------------- | ------------ | ----------------- | -------------------------------------------------- |
| NInfer            | 是           | 是 (cmake + CUDA) | 参考引擎。针对 Qwen 27B/35B 制品的实测 VRAM 模型。 |
| Hyper-Qwen (vLLM) | 是 (compose) | 否                | 由 `.env` 驱动的 docker-compose 配置。             |
| vLLM              | 否           | 否                | 进行中。                                           |
| llama.cpp         | 是           | 是                | 已指定，在二进制可用之前未验证。                   |
| Strata            | 是           | 否                | 占位符引擎；在其标志集落地之前，其参数表面为空。   |

运行时要求：Node `^22.19.0 || >=24.0.0`、pnpm 12.11.2（由 `mise.toml` 固定），以及 `@deepseek-ai/cordis >= 4.0.1` 同级依赖。

## 硬件指南

每台常见机器在实际中能为你带来什么。能力印象来源于 [r/LocalLLaMA](https://www.reddit.com/r/LocalLLaMA/) 用户帖子。"共享" 指统一内存（模型和操作系统共享内存池）。

| 硬件                          | 内存        | 你能得到的                                                                                                                           |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| NVIDIA RTX 5090               | 32 GB VRAM  | 可靠地容纳最多 23 GB 的模型权重，支持 240k+ 上下文和视觉。能处理复杂的编码和视觉任务，但需要特殊工具来处理非常长或复杂的任务。       |
| NVIDIA RTX 4090               | 24 GB VRAM  | 社区主力。Q4 量化下可容纳 30B 级模型并驱动编码代理；70B 需要缓慢的 CPU 卸载。性价比最高的单卡。                                      |
| NVIDIA RTX 3090               | 24 GB VRAM  | 二手卡的性价比之王。与 4090 相同的 24 GB，但属于较旧的世代：Q4 量化下 32B 及适度的上下文，不支持 FP8。单卡有限制；常见建议是配两张。 |
| NVIDIA RTX PRO 6000           | 96 GB VRAM  | 接近前沿的稠密模型（70B–80B）可完全装入内存并支持长上下文，32B 模型甚至可以进行微调（LoRA、全量 FT）。消费级上限。                   |
| NVIDIA RTX PRO 5500           | 84 GB VRAM  | 面向机架的 84 GB 级别：70B 级模型有余量，价格更低且接近 PRO 6000。                                                                   |
| NVIDIA Tesla V100             | 32 GB VRAM  | 便宜的二手 HBM2 服务器卡。Q4/Q8 量化下 30B 级模型，速度可观（带宽对推理而言才是关键）；不支持 FP8，功耗高。预算型家庭实验室之选。    |
| NVIDIA Tesla V100             | 16 GB VRAM  | 预算入门。Q8 量化下 13B–14B，或带卸载的 30B。NVLink 双卡翻倍容量。以现代标准来看较慢，但对推理而言出乎意料地扎实。                   |
| NVIDIA RTX 5090 Laptop        | 24 GB VRAM  | 移动端 4090。Q4 量化下 32B 勉强容纳；扣除上下文后现实上约为 Q4 的 ~17B。                                                             |
| NVIDIA RTX 4090 Laptop        | 16 GB VRAM  | GPU 对 LLM 而言过剩，而 VRAM 却不足：Q4/Q5 量化下 8B–14B，上下文较小。                                                               |
| NVIDIA GB10 (DGX Spark)       | 128 GB 共享 | 桌面 AI 开发机。35B MoE 以 ~100 tok/s 运行；120B+ MoE 可容纳但较慢。容量优先于速度。                                                 |
| NVIDIA GB10 (DGX Spark)       | 64 GB 共享  | 一半内存池：带上下文的 32B–35B MoE；70B 较为紧张。                                                                                   |
| NVIDIA RTX N1X                | 128 GB 共享 | 下一代 GB10 级笔记本：笔记本中的 DGX Spark 级容量。非常新，几乎没有真实世界数据。                                                    |
| NVIDIA RTX N1X                | 64 GB 共享  | 64 GB 级别：带上下文的 32B 级。                                                                                                      |
| Apple M4 Ultra                | 256 GB 共享 | 容量之王。200B+ MoE 和 128K 上下文的 70B 均可容纳；70B 预期 ~5 tok/s。单 token 较慢，容量无出其右。                                  |
| Apple M4 Ultra                | 128 GB 共享 | 70B–120B 级可容纳且有余量；~5 tok/s。容量出色，速度较慢。                                                                            |
| AMD Radeon AI PRO R9700       | 32 GB VRAM  | AMD 的 32 GB Vulkan 卡。Q8 量化下 32B 约 $1,300，性价比较高；`radv` 驱动并非符合规范的 Vulkan 实现。                                 |
| AMD Ryzen AI Max+ PRO 495     | 160 GB 共享 | UMA 怪兽。120B+ MoE 可容纳，编码代理运行良好（Qwen3-Coder 级模型针对 UMA 调优）；$7k+ 系统，速度慢于独立 GPU。                       |
| 2x NVIDIA RTX 3090            | 48 GB VRAM  | 社区的"可用作本地 LLM 的最低配置"：Q4/Q5 量化下的 70B。                                                                              |
| 2x NVIDIA RTX 4090            | 48 GB VRAM  | 带上下文的 Q4 量化 70B；exllama2 量化运行快速。                                                                                      |
| 2x NVIDIA RTX 5090            | 64 GB VRAM  | 带卸载的 ~10 tok/s，支持 128k 上下文的 120B MoE（GPT-OSS-120B）。                                                                    |
| 2x NVIDIA Tesla V100 (NVLink) | 64 GB VRAM  | 预算型 64 GB：NVLink 带宽下低量化的 70B；较旧的架构，不支持 FP8。                                                                    |
