# devn

[English](README.md) · [GitHub](https://github.com/tsangpo/devn)

在项目目录运行 `devn codex`、`devn claude` 或 `devn opencode`，自动选择对应的 Bifrost profile。每个 profile 有独立的 Codex、Claude、OpenCode 配置、插件和会话数据。

## Bun 全局安装

安装 Bun 后，全局安装即可直接使用 `devn` 命令：

```bash
bun i -g @tsangpo/devn
devn --version
devn profile add
```

## bunx 使用

npm 包名为 `@tsangpo/devn`，命令入口为 `bin/devn`，由 Bun 直接运行 TypeScript。使用以下命令运行：

```bash
bunx @tsangpo/devn --help
bunx @tsangpo/devn profile add
bunx @tsangpo/devn profile use customer-a
bunx @tsangpo/devn codex
bunx @tsangpo/devn claude
bunx @tsangpo/devn opencode
```

需要查看版本时运行 `devn --version`。需要固定版本时使用 `bunx @tsangpo/devn@0.1.1`。Codex、Claude Code 和 OpenCode 仍需自行安装并放入 PATH。

## Homebrew 安装

```bash
brew install tsangpo/tap/devn
devn --version
```

安装独立二进制，不需要 Bun。支持 macOS 和 Linux（glibc）的 arm64/x64。Codex、Claude Code 和 OpenCode 仍需另行安装。升级使用 `brew update && brew upgrade devn`；也可从 [GitHub Releases](https://github.com/tsangpo/devn/releases) 下载二进制与 SHA-256 校验文件。

## Windows 安装

Windows x64 可在 64 位 PowerShell（Windows PowerShell 5.1 或 PowerShell 7）中安装或升级最新稳定版：

```powershell
irm https://github.com/tsangpo/devn/releases/latest/download/install.ps1 | iex
```

也可在 cmd 或 PowerShell 中使用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -c "irm https://github.com/tsangpo/devn/releases/latest/download/install.ps1 | iex"
```

安装脚本校验 SHA-256，将 `devn.exe` 和许可证安装到 `%LOCALAPPDATA%\Programs\devn`，并加入用户 PATH；缺失 `LOCALAPPDATA` 时使用用户目录下的 `AppData\Local\Programs\devn`。无需管理员权限、Bun 或 Node.js。重复执行同一命令即可升级，保留 profile 和工具历史；Codex、Claude Code 和 OpenCode 仍需自行安装。

使用外层 `powershell -c` 命令安装后，关闭并重新打开终端应用，再运行 `devn --version`。如果提示另一份 devn 优先执行，请调整 PATH 或使用安装目录下 EXE 的完整路径。升级前请关闭正在运行的 devn。

安装入口将在包含此功能的首个稳定版本发布后可用。较早版本或指定版本仍可从 [GitHub Releases](https://github.com/tsangpo/devn/releases) 下载 `devn-vX.Y.Z-windows-x64.zip`，核对 SHA-256 后解压，将 `devn.exe` 所在目录加入 PATH。也可以安装 Bun 后使用 `bunx`，或运行 `npm install -g @tsangpo/devn` 在 PowerShell/cmd 中使用 `devn`。

客户端支持原生 EXE 和 Codex/Claude/OpenCode 的官方 npm 安装；JavaScript 客户端入口需要 Node.js，原生入口不需要。不执行自定义 cmd/bat/ps1 包装脚本。不支持 Windows ARM64、Scoop 或 winget。

默认配置和工具历史保存在 `%LOCALAPPDATA%\devn`，缺失该变量时使用用户目录下的 `AppData\Local\devn`。`XDG_CONFIG_HOME` 在所有平台上优先，不自动迁移旧目录。Windows 使用只允许当前用户和 SYSTEM 的 ACL，设置失败即停止操作。Profile 管理应在普通终端中运行，无需管理员权限。Windows 设备保留名不能用作 profile 名称，也不能注册仅大小写不同的名称。

## 从源码运行

支持 Linux、macOS 和 Windows 11 x64，需要 [Bun](https://bun.com/) **1.4.2 或更新版本**。所用的 Codex、Claude Code 或 OpenCode 由用户自行安装，并放入 PATH。

获取源码后，在仓库目录运行：

```bash
bun bin/devn --help
```

Linux/macOS 也可以将源码的 `bin` 目录加入 PATH，以便在项目目录使用 `devn`：

```bash
export PATH="/absolute/path/to/cli/bin:$PATH"
```

Bun 直接执行 TypeScript，无需安装项目依赖或构建。CLI 运行时不需要 Git checkout 或 GitHub 认证，也不会自行下载或更新代码。CLI 版本由包管理器管理。npm 与 Homebrew 通过 GitHub Actions 自动发布。

## 使用

```bash
devn --version
devn profile list
devn profile show customer-a      # 脱敏查看，本地读取
devn profile add                 # 输入 Profile JSON URL、本地名称、隐藏输入 key

cd /path/to/project
devn profile use customer-a     # 把当前目录绑定到该 profile
devn profile unbind            # 取消当前目录的绑定

devn codex
devn claude
```

`profile add` 输入的 URL 是公开的 Profile JSON 地址，例如 `https://config.example.com/customer-a.json`，不是模型网关地址。请求不携带 key；key 只用于工具连接 JSON 中指定的网关。下载并校验后展示已配置客户端的网关 origin，明确确认后才保存注册信息。默认要求 HTTPS；HTTP 只允许 localhost、127.0.0.0/8 和 ::1 回环地址供本地测试。远程配置重定向最多 5 次，HTTPS 不允许降级到 HTTP。

输入本地名称并确认更新（若有）后，devn 会先下载并校验 profile，再提示输入 key。若配置了 `authUrl`，会先显示完整链接，方便打开页面获取 key；支持 URL 识别的终端可直接点击，否则可复制到浏览器。随后将 key 粘贴到隐藏输入提示中。devn 不会自动打开浏览器或获取 key。

第二步始终提示输入本地名称。URL 中的 `customer-a.json` 会显示 `Profile name [customer-a]: `，直接回车采用默认值，也可输入其他名称。推导时忽略查询参数，对文件名进行 URL 解码，再去掉 `.json` 后缀（不区分大小写）；无法推导合法名称时不显示默认值，必须手动输入。

重复添加同名 profile 会询问是否更新 URL 和 key，保留工具数据。`profile use` 省略名称时列出已注册的 profiles。添加不会改变当前项目绑定，旧的 `profile init` 已由 `profile add` 替代。

项目绑定记录在 `~/.config/devn/config.toml` 的 `[projects]` 表中，键为目录真实路径，项目目录里不会写入任何文件：

```toml
[projects]
"/home/me/work/customer-a" = "customer-a"
```

从子目录启动时向上查找最近的已绑定目录；嵌套项目可以覆盖父目录绑定。`profile unbind` 只取消当前目录自身的绑定。未知、损坏或未注册的 profile 会报错，不会回退到其他客户。绑定按用户和路径保存，移动或重命名项目后需重新执行 `profile use`。

原生参数直接传给对应工具：

```bash
devn codex exec --skip-git-repo-check "Explain this project"
devn claude -p "Explain this project"
devn codex --model your-model-id
```

替换 provider、配置目录或工作目录的冲突参数会被拒绝。需要换目录时先 `cd`；需要换 profile 时执行 `devn profile use`。非交互结果写入 stdout，devn 启动和 profile 刷新提示写入 stderr。

## 模型由 Bifrost 管理

CLI 不内置任何客户 profile。远程配置不提供 `models` 时，devn 保留工具原生默认模型、原生菜单以及用户保存的选择，不强制模型参数。

工具仍会在请求中发送一个模型 ID。管理员需要在 Bifrost 配置对应的模型别名或路由，将这个 ID 映射到实际的供应商与模型。请以网关收到的请求为准；工具升级后默认 ID 可能改变。路由目标的工具调用、上下文长度、推理等能力应与客户端预期兼容。[Bifrost 路由说明](https://docs.getbifrost.ai/providers/provider-routing)

没有下发模型列表不代表网关自动接受任何 ID，实际访问权限由 Bifrost virtual key 控制。

## Profile 刷新与数据位置

`devn codex` / `devn claude` / `devn opencode` 每次先拉取该 profile 的远程 JSON，再生成工具配置。下载上限 1 MiB（解压后），请求最长等待十秒；网络错误、超时或 HTTP 5xx 时提示并使用有效缓存，没有有效缓存则报错。HTTP 4xx、无效 JSON、超大响应、不安全重定向或非法配置会阻止启动并保留原缓存。若网关 origin（协议、主机或端口）变化，也会停止启动；重新执行 `profile add` 查看并接受新地址。同一 origin 内的路径和模型更新自动生效。每个 profile 独立刷新加锁，慢请求不会阻塞其他 profile。`profile list` 和 `profile use` 只读取本地注册信息。

```text
~/.config/devn/
├── config.toml                  # 本地名称、远程 JSON URL、key、项目绑定
└── profiles/
    └── customer-a/
        ├── profile.json         # 校验后的远程配置缓存
        ├── codex/               # CODEX_HOME
        │   └── config.toml
        ├── claude/              # CLAUDE_CONFIG_DIR
        └── opencode/            # OPENCODE_CONFIG_DIR，含独立 data/cache/state/tmp
            └── settings.json
```

本地注册文件：

```toml
version = 1

[profiles.customer-a]
url = "https://config.example.com/customer-a.json"
key = "your-local-key"

[profiles.customer-a.origins]
codex = "https://gateway.example.com"
claude = "https://gateway.example.com"
```

启动前更新对应工具的配置，生成文件和密钥文件权限为 `0600`，profile 目录为 `0700`。Codex key 写入 `model_providers.bifrost.experimental_bearer_token`，Claude key 写入 `env.ANTHROPIC_AUTH_TOKEN`，OpenCode key 写入 `providers.bifrost.settings.apiKey`。这些文件在仓库之外，不会随 CLI 更新提交或覆盖。Key 当前保存在本机文件中；不使用 Bun.secrets，以便在没有系统密钥服务的 Linux/SSH 环境使用。

Codex 内置网页搜索默认设为 `disabled`，因为网关支持某个模型不代表支持 OpenAI 托管搜索。保留用户在 profile 的 `codex/config.toml` 中显式设置的 `web_search`。旧版本遇到搜索不支持错误时，可运行 `devn codex -c 'web_search="disabled"'`。

只合并 devn 管理的字段，保留个人设置、插件、MCP 和历史。`.devn-managed.json` 记录管理字段路径，不含 key，用于删除旧版本已停用的管理字段。不要手动编辑 devn 管理的连接字段；下一次启动会重新生成。损坏的配置文件会阻止启动，避免静默覆盖。

同一 profile 下的多个项目共用工具目录；不同 profiles 独立注册。不会复制原有 `~/.codex`、`~/.claude`。这属于配置与本地状态分离，不是操作系统级隔离。

## 管理 profile

管理员在 HTTPS URL 发布无密钥的 JSON。仓库只保留 `profiles/example.json` 供参考，CLI 运行时不会扫描该目录或自动注册示例。最简远程配置：

```json
{
  "version": 1,
  "baseUrl": "https://gateway.example.com",
  "codex": {},
  "claude": {}
}
```

远程网关同样默认要求 HTTPS，仅回环地址允许 HTTP。默认自动追加 `/openai/v1` 和 `/anthropic`；也可以分别在 `codex.baseUrl`、`claude.baseUrl` 提供完整接口路径。本地名称以字母或数字开头，只能包含字母、数字、连字符及下划线，长度不超过 64；保留名 __proto__、constructor、prototype 不可用。远程 `id`、`name` 是可选说明字段，不决定本地绑定或目录。请勿在 profile 定义中存储真实 key。

连接配置由代码根据 profile 的 URL 和本机 key 生成，再用 Bun.TOML / JSON 序列化；不使用 shell 或文本拼接插入密钥。个人设置直接保存在各 profile 的工具配置文件中，后续启动时保留。

可选顶层字段 `authUrl` 指向获取 key 的页面，例如 `"authUrl": "https://gateway.example.com/keys"`。允许路径和查询参数；要求 HTTPS（仅回环地址允许 HTTP），不允许 URL 用户凭据、fragment 或控制字符。不填写时保持普通 key 输入提示，不显示链接。

默认无需维护模型列表。需要统一模型菜单时，参考 `profiles/example.json`，发布前填写真实值并删除 `example: true`。

示例为 Codex 列出 3 个 OpenAI 模型，为 Claude 列出 Claude Opus/Sonnet 5.5 和 `opusplan` 模式，为 OpenCode 列出全部 6 个网关模型（含 Gemini 3.8 Flash）。Codex/OpenCode 默认使用 GPT 6.1 Sol，Claude 默认使用 `opusplan`。模型 ID 和 token 限制来自提供的网关列表；OpenCode 价格由每 token 换算为[每百万 token](https://opencode.ai/v2/docs/providers)。可选能力字段使用客户端原生默认值，包括文本/图片输入和 OpenCode 工具支持；Codex 声明 freeform 补丁工具。列表未声明实际工具、多模态或推理能力，发布前须核实这些默认值。示例省略可选的 `name`；请替换或删除示例 `authUrl`。Profile schema 没有网页搜索费用字段，因此未写入该价格。

使用示例 Codex catalog 前，须为每个模型补充与原生客户端及后端匹配的 `base_instructions` 或 `model_messages.instructions_template`。示例省略了这些指令；已测试的 Codex 客户端会拒绝缺失指令的 catalog，devn 不会自动补充。已验证的客户端版本见 [CONTRIBUTING.md](CONTRIBUTING.md#compatibility)。

Codex 使用 `codex.model` 指定默认模型，`codex.models` 直接存放原生 catalog 对象：`slug`、`display_name`、`description` 和能力字段。devn 仅包一层 `{ "models": [...] }` 写入 `model_catalog_json` 指向的文件，不再补充或覆盖 `priority`、`visibility`、`supported_in_api` 等字段。能力字段必须与真实后端一致。

Claude 使用 `claude.model` 和原生 `claude.modelPicker`：`replaceBuiltInOptions` 必须为 `true`，`options` 条目使用 `model`、`label`，可选 `description`、`behavesAs`。菜单原样写入 settings；可选 `slots` 仍将 `opus`、`sonnet`、`haiku` 转换成对应环境变量。远程配置不能传入任意 settings，例如 key、hooks 或权限。

使用 `opusplan` 时须显式将三个 `slots` 映射到真实网关模型 ID。示例的规划阶段使用 Opus 5.5，执行阶段使用 Sonnet 5.5；列表没有 Haiku 模型，因此 Haiku 槽位也使用 Sonnet。不设置 `slots` 时，devn 会将全部槽位设为 `claude.model`，导致把 `opusplan` 原样发给网关，并可能出现未知模型警告。

已保存模型仍在列表中时保留，否则采用管理员默认值。移除中央模型列表会恢复原生菜单并保留用户选择。

旧格式迁移：将 `defaultModel` 改为 `model`；Codex 将 `metadata` 展开到模型顶层，将 `id`/`name` 改为 `slug`/`display_name` 并显式填写 catalog 展示字段；Claude 将 `models` 移到 `modelPicker.options`，将 `id`/`name` 改为 `model`/`label`。托管 manifest 与 CLI 需同步更新，旧模型格式会被拒绝。仅配置 URL 的 profile 不受影响。

参考：[Codex 配置](https://learn.chatgpt.com/docs/config-file/config-reference)、[Claude 配置目录](https://code.claude.com/docs/en/env-vars)、[Claude 模型菜单](https://code.claude.com/docs/en/settings-reference#modelpicker)。

## OpenCode v2

需单独安装官方 `@opencode/cli`，接受任意 v2 版本，不限制最低次版本或补丁版本。优先检查 PATH 中的 `opencode`，没有符合版本要求的客户端时尝试 `opencode2`。支持 Windows 原生 EXE 和官方 npm 安装；devn 不自动安装、升级或迁移客户端。

在现有 `version: 1` 远程 profile 中添加可选字段：

```json
"opencode": {
  "model": "coding",
  "models": {
    "coding": {
      "modelID": "openai/your-chat-model",
      "name": "Coding model",
      "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },
      "limit": { "context": 128000, "output": 16000 }
    }
  }
}
```

`models` 必须是非空映射，`model` 必须引用其中一个键。模型接受原生 v2 字段 `name`、`modelID`、`family`、`capabilities`、`limit`、`cost`（`input`、`output` 和可选的 `cache.read`/`cache.write`）。远程配置不能指定 provider 包、连接覆盖、请求头、凭据或配置变量替换。省略 `modelID` 时，映射键就是发送给网关的模型 ID；能力字段需与实际后端一致。

固定使用 `bifrost` provider，经 OpenAI 兼容的 Responses API 请求 `<baseUrl>/openai/v1/responses`。可用 `opencode.baseUrl` 指定 API 基础地址（如 `https://gateway.example/v1`），不要加 `/responses`，provider 会自动追加。网关必须支持 Responses 请求和流式事件，仅支持 Chat Completions 的网关不兼容。已有的 OpenCode 托管配置会在下次启动时自动切换 provider。不继承 Codex 的地址或模型列表。旧 profile 仍可运行 Codex/Claude；补充 OpenCode 后，需重新执行 `devn profile add` 确认新增网关 origin。发布新增字段前需先升级到 devn 0.5.0 或更新版本；旧版 CLI 会拒绝该字段。

```sh
devn opencode
devn opencode run --model bifrost/coding "Explain this project"
devn opencode mini
devn opencode models
```

`models` 直接显示已审批的 profile 模型列表，避免 v2 独立服务尚未完成插件加载时返回空列表。交互界面的 `--model bifrost/<键>` 由 devn 设置为本次默认模型；`run`、`mini` 使用原生参数。生成配置中的已有模型选择仍在列表中时保留，否则回退至 profile 默认模型。

配置、会话、缓存、状态和临时文件均位于 `profiles/<名称>/opencode/`，每次使用独立服务。保留真实 HOME；XDG 和临时目录覆盖只影响客户端及其子进程。devn 管理 `opencode.json`、`service.json`、Bifrost provider 和 provider 策略，其余本地 JSON 设置保留。个人 agents、skills、MCP、服务端插件放在该 profile 目录，终端偏好放在其中的 `cli.json`。请编辑 `opencode.json`；相邻的 `opencode.jsonc` 会覆盖托管配置，因此启动时会拒绝它。

如果 `cli.json` 不存在，devn 会创建它并写入 v2 CLI schema 和 `system` 主题；已有文件保持不变。

不加载项目 OpenCode 配置，也不自动发现项目指令或兼容加载全局 Claude/agents skills。v2 的客户端插件发现机制独立于服务端，所以交互界面和插件命令遇到祖先目录中非空的 `.opencode/plugins` 时会提示将插件移入 profile。这属于配置和状态分离，不是针对用户安装插件的安全沙箱。

支持交互界面以及 `run`、`mini`、`models`、`session`、`stats`、`debug`、`acp`、`mcp`、`plugin`、`reload`。`mcp add` 写入 profile 的全局配置。不透传目录切换、外部服务器、共享服务管理、`serve`、`pair`、`auth`、`api`、升级或卸载命令；请从已绑定项目目录运行。通过 `devn profile add` 更新 key；移除 profile 默认清除生成的 key、保留会话，`--purge` 删除全部数据。

参考：[v2 providers](https://opencode.ai/v2/docs/providers)、[独立服务](https://opencode.ai/v2/docs/cli)、[provider 策略](https://opencode.ai/v2/docs/policies)。

## 开发与验证

```bash
bun run check
```

Bun 直接执行 TypeScript 源文件，项目没有 dependencies / devDependencies，无需 install、build 或 dist 目录。CI 在 Linux 和 macOS 运行行为测试、example 校验及二进制测试。Bun 不执行静态类型检查；check 验证运行时行为。

```bash
bun run validate                 # 校验仓库 example，不读取本地 key
bun run test:native              # 需要本机 codex / claude / opencode；仅连接本地模拟网关
```

原生测试位于 `test/native/`，覆盖 Codex/Claude 默认与中央模型配置，以及 OpenCode v2 的网关、认证、模型目录和数据路径隔离；使用本地模拟网关和临时目录。

`bun run test` / `bun run check` 只运行常规测试；`bun run test:native` 运行原生测试，直接执行 `bun test` 还包含二进制测试，需先运行 `bun run build:binary`。

原生测试使用临时 profile 和虚拟 key，检查真实客户端的默认模型、认证头、接口和流式输出，不调用真实 Bifrost。常规测试使用 Bun 自带伪终端验证密码不回显，无需 Python。

配置与工具数据使用 `${XDG_CONFIG_HOME:-~/.config}/devn`，测试通过 `XDG_CONFIG_HOME` 隔离数据。CLI 源码可以放在任意目录，移动或升级代码不会迁移用户数据。

## 从旧版迁移

旧开发版本的注册记录若没有已批准的 origins，需执行 `devn profile add` 重新添加并确认网关地址。搬迁配置或工具数据前先停止工具会话；复制历史和个人设置到 profile 目录时保留文件权限，key 以 `config.toml` 为准。不会自动迁移旧开发版本的数据目录。

已验证基线：Bun 1.4.2、Codex 0.159.2、Claude Code 2.1.285；OpenCode 新增本地网关验证基线为 2.0.21。

## 删除 profile

`devn profile remove customer-a` 输入名称确认后删除本地注册、key 及 devn 写入工具配置的认证字段，保留历史和个人设置。先停止该 profile 的工具会话；运行中的进程、备份或历史中的敏感内容不会被自动清除。

`devn profile remove customer-a --purge` 会额外删除整个 profile 目录及会话历史。已经移除注册后，仍可用这条命令清理保留的数据。项目绑定不会自动删除或切换到其他 profile。

## 开源与发布

MIT 许可证，Copyright (c) 2026 tsangpo。参见 [LICENSE](LICENSE)、[贡献与发布说明](CONTRIBUTING.md)、[安全政策](SECURITY.md) 和 [更新记录](CHANGELOG.md)。

`bun run check:secrets` 检查工作区与可达 Git 历史中的已知 token/私钥特征，不输出匹配值。它无法识别全部自定义 key 或客户信息，发布前仍应检查实际 tarball 和文档。

推送与 package.json 版本一致的正式 `vX.Y.Z` tag，会触发 Release 工作流：验证同一份 npm tarball 和五个平台的二进制，自动发布 npm 与 GitHub Release，验证 Homebrew 安装后更新 `tsangpo/homebrew-tap`。npm 发布使用 Trusted Publishing（OIDC），不再注入 `NPM_TOKEN`；tap 更新使用仅授权 tap 仓库 Contents 写入的 `GH_PAT`。首次无 token 新版本发布成功后，可删除旧 GitHub secret 并撤销 npm token。配置步骤见 [贡献与发布说明](CONTRIBUTING.md#release-setup)。

本地构建及验证当前平台二进制：

```bash
bun run build:binary
bun run test:binary
```

产物放在忽略提交的 `release/`，不引入 dist 或项目依赖。正式发布工作流仅接受稳定版本，不发布预览版。

此前注册记录若没有 origins，升级后需重新运行 `profile add` 接受网关地址；工具历史保留。配置格式 version 1 继续支持，未知版本报错，不会静默迁移。兼容范围和发布前测试要求见 CONTRIBUTING.md。
