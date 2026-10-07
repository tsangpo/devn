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

参数会转发给原生客户端。被 devn 管理的 provider、profile 和工作目录参数不能覆盖；请使用 `cd` 和 `devn profile use`。

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

每次启动前都会刷新 profile。临时网络错误和 HTTP 5xx 可以使用有效缓存；无效配置、不安全重定向、HTTP 4xx 或网关 origin 变化会停止启动。origin 变化时重新执行 `profile add` 批准即可。

不提供模型列表时，客户端保留自己的默认值。发布模型列表时请使用客户端原生格式，并将模型 ID 映射到真实的 Bifrost 路由。仓库中的示例仅供参考，不会自动注册。

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
