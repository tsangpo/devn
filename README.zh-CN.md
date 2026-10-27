# devn

通过 Bifrost 网关启动 Codex、Claude Code 和 OpenCode v2 的项目级 CLI。

[English](README.md) · [仓库](https://github.com/tsangpo/devn) · [安全说明](SECURITY.md) · [贡献与发布](CONTRIBUTING.md)

devn 将项目绑定到本地 profile。profile 来自管理员发布的 JSON 配置，并拥有独立的客户端配置、凭证、插件和历史记录。devn 不附带客户 profile，不复制全局客户端数据，也不会自动更新自身。

## 安装

支持 Linux、macOS 和 Windows 11 x64。先单独安装需要的客户端：

```sh
bun i -g @anthropic-ai/claude-code @openai/codex @opencode/cli
```

使用 Bun 安装 devn：

```sh
bun i -g @tsangpo/devn
devn --version
```

一次性运行可使用 `bunx @tsangpo/devn ...`。Homebrew 可安装不依赖 Bun 的 macOS/Linux 二进制：

```sh
brew install tsangpo/tap/devn
```

Windows 使用 Bun/npm 包。源码和 npm 包要求 Bun >=1.4.2；二进制不要求。二进制平台和校验值见[发布页](https://github.com/tsangpo/devn/releases)。

## Profile

```sh
devn profile add https://config.example.com/team.json
devn profile list
devn profile show customer-a
devn profile use customer-a
devn profile remove customer-a
devn profile remove customer-a --purge
```

`profile add` 会下载并校验 JSON，要求输入本地名称并批准所有网关 origin。手动 profile 输入隐藏的 key；OAuth profile 使用 `--auth auto`、`--auth browser` 或 `--auth device`。每个 profile 使用独立 session；重新添加同名 profile 可以更换 URL 或 key，同时保留工具历史。

在已绑定的项目中运行客户端：

```sh
devn codex
devn claude
devn opencode
```

参数会转发给原生客户端。被 devn 管理的 provider、profile 和工作目录参数不能覆盖；请使用 `cd` 和 `devn profile use`。Codex 运行时禁用共享后台 daemon（`daemon_auto_start = false`），交互会话还会加上 `--no-daemon`，不会连接已在运行的 daemon。

## 项目绑定

```sh
cd /path/to/project
devn profile use customer-a
devn profile unbind
```

绑定保存在用户配置中，不会写入项目。devn 从当前目录向上查找最近的绑定，嵌套项目可以覆盖父目录。绑定缺失或无效时直接报错，不会静默选择其他 profile。

## 远程 Profile

最小配置如下：

```json
{
  "version": 1,
  "baseUrl": "https://gateway.example.com",
  "codex": {},
  "claude": {}
}
```

`baseUrl` 默认给 Codex 追加 `/openai/v1`，给 Claude 追加 `/anthropic`；也可以用客户端自己的 `baseUrl` 覆盖。JSON 中不要放真实 key。除本地测试的回环地址外必须使用 HTTPS；下载有大小和超时限制。

OpenCode 的模型条目会原样写入 OpenCode 配置，因此可以使用 v2 的任意模型字段（`limit`、`cost`、`variants`、`headers` 等）。模型可以用 `package` 换成另一个内置协议（只允许 `@opencode/ai/providers/...`），并用自己的 `settings.baseURL`，但它必须使用 OpenCode 网关的 origin；devn 会把 key 加进这些 settings。模型 settings 里不能写凭证，也不能使用 `{env:`/`{file:` 替换。例如让 Claude 走 Bifrost 的 Anthropic 接口：

```json
"bedrock/global.anthropic.claude-haiku-5-5": {
  "package": "@opencode/ai/providers/anthropic-compatible",
  "settings": { "baseURL": "https://gateway.example.com/anthropic/v1" }
}
```

每次启动前都会刷新 profile。临时网络错误和 HTTP 5xx 可以使用有效缓存；无效配置、不安全重定向、HTTP 4xx 或网关 origin 变化会停止启动。origin 变化时重新执行 `profile add` 批准即可。

### 模型发现

客户端段没有模型列表时（`"codex": {}`、`"claude": {}` 或 `"opencode": {}`），每次启动该客户端，devn 都会用用户的 key 请求网关的 `GET <baseUrl>/v1/models`。该 key 可用的所有模型都会提供给客户端，devn 据此生成配置：

- Codex：生成 `models.json` 目录。每个条目以已安装 Codex 自带的目录（`codex debug models --bundled`）为基础。以自带 slug 结尾的 ID（例如 `bedrock/global.openai.gpt-6.1-sol`）继承该模型的设置。其他模型保留 Codex 的指令，但不声明推理级别。托管专用的搜索、服务层级和实验工具会被移除。
- Claude Code：生成 `/model` 选项，以及 `ANTHROPIC_DEFAULT_OPUS_MODEL`、`_SONNET_MODEL`、`_HAIKU_MODEL` 三档。每档取 ID 同时含 `claude` 和 `opus`/`sonnet`/`haiku` 的最新版本（忽略发布日期和 `-v1:0` 后缀）。缺少的档位借用其他档位的模型。同时有 Opus 和 Sonnet 时，在最前面加入 `opusplan` 选项（规划时用 Opus，其余用 Sonnet）并设为默认；否则默认用 Sonnet 档。
- OpenCode：生成 `bifrost/<id>` 模型，并带上网关报告的上下文和输出上限。

第一个 OpenAI/GPT 模型作为 Codex 和 OpenCode 的默认模型。没有识别到 Claude 档位时，第一个 Anthropic/Claude 模型作为 Claude 的默认模型。用户之前选择的模型只要网关仍提供就会保留。已弃用的条目，以及含空白、控制字符或 `{env:`/`{file:` 模板的 ID 会被跳过。

key 只发送到已批准的 `baseUrl` origin，不跟随重定向。网关不可达或返回 HTTP 5xx 时，使用上一次获取的列表。HTTP 4xx、无效响应或空列表会停止启动。profile 中显式提供的列表始终优先，此时不会请求网关。发布 `"opencode": {}` 前请先升级 devn，旧版本会拒绝该写法。

发布中央模型列表时请使用客户端原生格式，并将模型 ID 映射到真实的 Bifrost 路由。仓库中的示例仅供参考，不会自动注册。

### Claude Code 网关开关

`claude.env` 可选，用于设置 Claude Code 面向网关的兼容开关。只接受下表中的名称和取值，其他内容会使 profile 校验失败。默认使用最新版 Claude Code。

| 名称                                             | 取值       | 用途                                                                                                                                                                    |
| ------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`         | `1`        | 上游（如 Bedrock）以 `Extra inputs are not permitted` 拒绝请求时，停止发送预发布 beta 头及配套字段（`defer_loading`、`context_management`）。同时关闭 MCP tool search。 |
| `CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS`         | `1`        | 只去掉结构化输出的 format 字段。                                                                                                                                        |
| `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING` | `0`、`1`   | 经网关流式传输工具参数；自定义 base URL 下默认关闭。                                                                                                                    |
| `CLAUDE_CODE_PROMPT_CACHE_TTL`                   | `5m`、`1h` | 主对话的 prompt cache 有效期。                                                                                                                                          |
| `CLAUDE_CODE_GATEWAY_HINT_HEADERS`               | `0`、`1`   | 向网关发送 `x-claude-code-*` 路由提示头。                                                                                                                               |

从 profile 中删除某个名称后，下次启动会从生成的配置中移除它。发布 `claude.env` 前请先升级 devn：旧版本会拒绝该字段。

`claude.disabledTools` 可选，用于关闭网关无法提供的 Claude Code 工具。目前只接受 `WebSearch`：它依赖 Anthropic 服务端执行搜索，网关转发到 Bedrock、OpenAI 或 Gemini 时不会执行，模型只会得到“没有搜索工具”的回复。devn 会把这些名称加入生成配置的 `permissions.deny`，并保留你自己的其他 deny 规则；从 profile 中删除后，下次启动会移除。发布该字段前请先升级 devn：旧版本会拒绝它。

通过 Bifrost 使用 Bedrock 时，图片和 prompt cache 还取决于网关：放行全部客户端请求头（至少 `anthropic-beta` 和 `anthropic-version`），并使用在 Bedrock 路由上保留 Anthropic `image`、`tool_result` 和 `cache_control` 块的 Bifrost 版本。缓存失效不会报错，请在网关日志中确认第二轮起 `cache_read_input_tokens` 不为 0。

## 本地数据与限制

Unix 数据目录为 `${XDG_CONFIG_HOME:-~/.config}/devn`，Windows 为 `%LOCALAPPDATA%/devn`。每个 profile 保存远程 JSON 缓存以及独立的 Codex、Claude、OpenCode 目录。托管凭证写入私有权限的客户端配置文件；它们是本地明文 secret，不是加密存储。删除 profile 会清理 devn 管理的凭证，`--purge` 还会删除 profile 数据。

devn 隔离配置和客户端状态，但不是操作系统级沙箱。使用不受信任的插件或 profile 前请阅读 [SECURITY.md](SECURITY.md)。

## 开发与发布

```sh
bun run check
bun run test:native       # 需要已安装客户端和本地测试网关
bun run check:secrets
bun run build:binary
bun run test:binary
```

原生测试使用虚拟 key 和回环网关。发布流程、兼容范围、已测试客户端版本和 Windows 细节见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT — Copyright (c) 2026 tsangpo。详见 [LICENSE](LICENSE)。

### 遥测

在 profile 根节点设置 `"telemetry": false`，统一关闭三个客户端的遥测、错误/反馈上报及 OpenTelemetry 导出，包括继承的 OTEL 地址、Claude 反馈调查和 Codex `/feedback`。保留本地日志与 Bifrost 用量统计。通过 devn 启动客户端及探测客户端时生效；已运行的客户端需要重启。策略生效时拒绝 Codex 命令行覆盖遥测配置。该策略针对客户端内置功能，不管理任意第三方插件。

只接受省略或 `false`。省略维持旧行为；移除字段后，各客户端下次启动时移除 devn 管理的遥测设置，不恢复之前被覆盖的值。发布该字段前先升级到 devn 0.9.2 或更高版本；0.9.1 及更早版本会拒绝该字段。不会自动迁移已保存的 profile。
