# MadoPilot 用于 Elftia Computer Use 的分析与接入

## 结论

MadoPilot 适合做 Computer Use 的**可选本机能力**：它提供原生窗口采集、OpenCV 模板匹配、OCR、等待视觉条件以及有目标和帧约束的输入。现有 PowerShell Computer Use CLI 继续负责通用桌面截图、UIA 和键盘操作；插件中 vendored 的 CLI 增加 `mado` 命令。本机已安装并编译完整依赖，插件开发 worktree 的 `dist/computer-use/` 和本地打包产物包含原生程序、DLL 与 OCR 模型，无需临时环境变量即可运行。二进制资产被 Git 忽略，其他机器构建安装包前仍需执行本地原生安装步骤。

依据为本地 MadoPilot 源码提交 `e6b3f55914fb942afe4049630e659b2793ea1220`，Rust 依赖在 `native/mado-pilot-sidecar/Cargo.toml` 固定到该提交。

## 工作原理

```text
Agent → Computer Use CLI (Node)
      → 单次本机子进程（JSON stdin / JSON stdout）
      → MadoPilot Engine → 原生窗口采集与输入 / OpenCV / ONNX OCR
      → PNG 写入 --out；stdout 只返回路径、匹配框、文字或输入回执
```

1. CLI 严格解析 `mado --action ...`，自动查找随插件安装的 `scripts/native/elftia-mado-pilot-sidecar.exe`，也接受绝对路径环境变量覆盖。每次调用有超时，响应上限 1 MiB，超时或异常退出转换为 CLI JSON 错误。
2. 子进程创建 MadoPilot Engine。`list-targets` 仅列出有原生进程来源信息的窗口，并为标题、进程 ID、进程生命周期和可执行文件路径计算不透明选择器。后续命令启动新 Engine，重新发现且要求**恰好一个**匹配窗口。MadoPilot 的 `TargetId` 含 Engine 身份，不能直接跨进程使用。
3. 对目标建立 Session，获得带流、代、序号和几何版本的帧。`capture` 将像素写为 PNG。`find-template` 在该帧上用 OpenCV 做匹配，`wait-template` 可从静止窗口的首个匹配帧命中。`read-text` 对该帧做 OCR，返回文本区域、置信度和几何点。
4. `click` 先获取当前帧，要求其可见像素哈希与先前 `capture.image_hash` 完全一致，再按 capture-pixel 坐标发送一次主键鼠标序列。必须显式选 `system`、`window-message` 或 `process-directed` 路由；提交绑定帧的几何版本。`system` 路由会尝试激活目标窗口。完整提交后等待最多 1.5 秒获取严格更新的帧；若没有新帧，返回 `after_available:false` 和原生回执，调用方应另行截图验证。不完整提交保留故障与尝试回执并返回失败，调用方不得自动重试。输入回执只证明原生提交，不证明目标应用产生了预期效果。
5. Session 在正常或错误路径上显式关闭。每次 CLI 调用只处理一个请求，进程结束后不持有长期会话。

## 模型与运行依赖

| 能力 | 模型 / 依赖 | 说明 |
| --- | --- | --- |
| 窗口采集 | Windows Graphics Capture / Win32，图形设备 | 不需要大语言模型；由本机窗口和显示权限决定 |
| 模板匹配 | OpenCV 0.99 Rust 绑定及对应原生 OpenCV 库 | 图片算法，不需要下载视觉神经网络模型；调用方提供 PNG 模板 |
| OCR | MadoPilot 默认受控 RapidOCR 配置：PP-OCRv4 mobile detector、PP-OCRv6 small recognizer；ONNX Runtime 1.29.0 / API 17 | 本机捆绑的模型与运行时自动发现；也可用绝对路径覆盖；无隐式下载或 PATH 搜索 |
| 输入 | Windows 原生输入与 MadoPilot 目标/几何校验 | 不需要模型；具体路由能力由窗口决定 |
| Agent 决策 | Elftia 当前会话模型 | MadoPilot 本身不负责理解任务、规划或判断屏幕语义 |

本机原生构建需要 MadoPilot 上游声明的 Rust 1.97.1、OpenCV 开发文件、LLVM/libclang 和 Windows C/C++ 构建工具。OCR 模型文件须符合 MadoPilot 的固定路径和哈希要求。本机使用 OpenCV 4.14.0、LLVM/libclang 22.1.8、VS 2022 Build Tools、ONNX Runtime 1.29.0 和两份已校验哈希的模型。构建依赖留在独立本机目录；插件安装树只包含运行依赖。

## 与现有 Computer Use 的关系和限制

模板匹配适合稳定图标、按钮或视觉状态；OCR 适合获取屏幕文字。二者可减少仅靠视觉模型描述截图时的模糊性，但仍须遵守现有“感知 → 一次动作 → 验证”循环。MadoPilot 坐标是**采集图像像素**，原 CLI `click` 坐标是**屏幕全局像素**，不能混用。模板和 OCR 结果也只对应返回的那一帧。

跨命令选择器能拒绝进程重启、PID 复用、标题改变和同名歧义；同一存活进程若重建同标题窗口，仍可能匹配。输入前须重新采集并观察，随后提供该次截图的 `image_hash`；画面改变时点击会被拒绝。完全相同的画面仍不能证明窗口实例相同，选择器不是永久窗口句柄。当前集成只支持一次主键点击，没有自动根据模板框点击、输入文本、键盘、滚动或多步骤脚本。等待模板有上限，避免常驻后台进程。

## 当前验证与交付状态

- Rust release 编译和上游 OpenCV C++ 编译、链接、运行探针通过。CLI 的 `mado` 自动测试通过；插件的 23 项测试、lint、安装树与打包校验通过。
- 自建 WinForms 窗口端到端验证：发现目标、采集 682×391 PNG、模板匹配得分约 0.9999996、静止窗口等待模板命中、OCR 读出标题与两行控件文字；`window-message` 点击自建窗口后状态文件由 `ready` 变为 `clicked`，并得到更新帧。
- 插件开发 worktree 的本地原生 bundle 可直接执行 `mado --action health`，得到 `ocr_ready:true`；`dist/computer-use/` 的同一命令也通过。本机 `npm run verify` 生成包含 bundle 的 `release/0.8.2/computer-use.epkg`。
- Windows 的前台焦点策略会因调用环境拒绝 `system` 路由；测试中回执明确为 `FocusRefused`。`window-message` 对顶层窗口成功提交也不保证子控件接收点击；应观察后续画面或应用状态。`process-directed` 在该 WinForms 测试窗口上不可用。尚未验证任意第三方应用的输入路由。
- 本机二进制和模型未进入 Git。另一台打包机须先构建 sidecar、安装兼容依赖，并在插件仓库执行 `npm run install:mado-native -- <sidecar.exe> <opencv_world4140.dll> <onnxruntime.dll> <model-root>`，再构建插件。生产分发仍需按项目流程处理签名和第三方依赖许可。
