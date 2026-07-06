# Dual-Engine Agent

Dual-Engine Agent 是一个本地桌面 AI 编程代理。它把任务拆成两个阶段执行：

- Planner：把用户请求拆解成可执行的子任务。
- Worker：读取/修改工作区文件、运行命令、打开浏览器预览，并把执行过程展示在聊天里。

应用基于 Electron、React、Vite、TypeScript 和 Vercel AI SDK 构建，面向本地代码工作区使用。

## 主要功能

- 打开本地工作区，浏览文件树，查看和编辑文件。
- 使用 Monaco Editor 查看代码和 diff。
- 通过聊天让代理执行编码任务。
- 自动记录任务状态、工具调用、终端日志和 API 调用次数。
- 支持文件工具：
  - `readFile`
  - `createFile`
  - `writeFile`
  - `editFileContent`
- 支持命令工具和浏览器预览工具。
- 支持多提供商配置和主/副模型分离选择。
- 内置 Responses API Adapter，用于把部分 OpenAI Chat Completions 请求转换到 Responses API。
- 保存工作区状态和聊天历史，重启后可恢复。

## 模型与提供商配置

设置面板中使用“配置管理”作为核心结构。一个配置包含：

- 配置名称
- 提供商类型
- API Key 或 OAuth Token
- Base URL
- 默认转换器
- 按模型覆盖的转换器

当前内置的提供商类型：

- OpenAI-compatible
- SenseNova
- Anthropic
- Google Gemini

主模型和副模型可以选择不同配置下的不同模型。聊天栏里的模型选择器按两层显示：

1. 左侧选择配置。
2. 右侧选择该配置下的模型。

选中后，聊天栏只显示模型名，避免占用太多空间。

## Responses API Adapter

项目内置 `Responses API Adapter` 转换器，不依赖外部脚本或桌面上的协议转换服务。

它会启动本地代理：

```text
http://127.0.0.1:18765
```

当某个配置或某个模型启用该转换器时，运行时 Base URL 会被重写到内置代理，再由代理决定是否转换请求。

当前转换的模型包括：

- `gpt-5.5`
- `gpt-5.4`
- `gpt-5.4-xhigh`
- `gpt-5.3-codex`
- `gpt-5.3-codex-spark`

其他模型会透传到原始提供商地址。推荐做法是只给需要 Responses API 的模型设置“模型级转换器覆盖”，例如让 `gpt-5.5` 使用 `Responses API Adapter`，而同一配置里的其他 OpenAI-compatible 模型保持 `None`。

## 本地开发

### 环境要求

- Node.js 18 或更高版本
- pnpm

### 安装依赖

```bash
pnpm install
```

### 启动开发版

```bash
pnpm dev
```

开发模式会启动 Vite 和 Electron。默认渲染端地址：

```text
http://localhost:5173/
```

### 类型检查

```bash
pnpm exec tsc --noEmit
```

### 打包

```bash
pnpm build
```

## 使用流程

1. 启动应用。
2. 打开一个本地文件夹作为工作区。
3. 进入设置面板，创建或选择提供商配置。
4. 填写 API Key / Base URL / OAuth 设置。
5. 分别选择主模型和副模型。
6. 在聊天框输入任务。

常见任务示例：

```text
检查这个项目的启动错误并修复
```

```text
给当前 HTML 项目加一个可玩的坦克大战 demo，并打开浏览器预览
```

```text
阅读 README 和 package.json，帮我总结项目结构
```

## 工作区与本地数据

应用会把全局配置、工作区状态和聊天历史保存到 Electron 的 userData 目录。

Windows 默认路径类似：

```text
%APPDATA%\Dual-Engine Agent
```

其中常见文件：

- `global-config.json`：提供商配置、模型选择、上次工作区。
- `workspace-state.json`：打开的标签页、当前文件等。
- `chat-history.json`：按工作区保存的聊天历史。

API Key 会保存在本机配置文件中。这个项目目前没有实现系统钥匙串或加密存储，请只在可信设备上使用。

## 项目结构

```text
dual-engine-agent/
├── electron/
│   ├── converters/
│   │   └── responsesProxy.ts       # 内置 Responses API Adapter 代理
│   ├── ipc/                        # Electron IPC 处理
│   ├── tools/                      # Worker 可调用工具
│   ├── main.ts                     # Electron 主进程入口
│   ├── planner.ts                  # Planner 引擎
│   └── worker.ts                   # Worker 引擎
├── src/
│   ├── components/                 # React UI 组件
│   ├── hooks/                      # 配置、工作区、会话、滚动等状态逻辑
│   ├── converterPlugins.ts         # 渲染端转换器插件注册
│   ├── App.tsx                     # 应用主界面
│   └── main.tsx                    # React 入口
├── package.json
├── vite.config.ts
└── electron-builder.json5
```

## 工具调用约定

Worker 的系统提示要求模型使用专用工具完成文件和浏览器操作：

- 读文件必须使用 `readFile`。
- 创建或修改文件必须使用 `createFile`、`writeFile` 或 `editFileContent`。
- 预览网页必须使用 `openBrowser`。

`editFileContent` 需要传入当前文件中精确存在的 `targetContent`。如果目标块找不到，工具会返回最接近的当前代码块和第一处差异，并提示模型重新读取文件后再编辑，减少重复失败。

## 常见问题

### 模型列表里缺少某些模型

确认当前配置的 Base URL 和 API Key 能返回完整模型列表。OpenAI-compatible 配置不会再只过滤 `gpt-*` 模型，因此类似 `Ornith` 这类模型也应显示。

### 某些模型报 `/v1/chat/completions endpoint not supported`

这类模型可能只支持 Responses API。给该模型设置模型级转换器覆盖，选择 `Responses API Adapter`。

### 任务停在 `API Calls: 2` 很久

通常表示 Worker 已完成第一轮工具调用，正在等待模型基于工具结果继续分析。大文件或慢模型会导致等待时间较长。后续可以在任务执行层增加超时和更细的等待状态提示。

### 文件编辑提示 `Target content not found`

说明模型使用的目标代码块和当前文件内容不一致，常见原因是文件刚被前一步改过。工具会返回最接近匹配块，模型应重新读取文件并使用最新内容重试。

### 日志窗口不自动滚动

日志窗口现在采用和聊天窗口一致的贴底逻辑：滚动条接近底部时新日志会自动跟随；手动往上查看旧日志时不会被强制拉到底部。

## 维护说明

提交前建议至少运行：

```bash
pnpm exec tsc --noEmit
```

如果改动了 Electron 主进程、IPC、工具或转换器逻辑，开发模式下通常会触发 Electron 重建和重启。正在运行中的代理任务可能会被重启打断，调试时注意避开长任务执行期间修改主进程代码。
