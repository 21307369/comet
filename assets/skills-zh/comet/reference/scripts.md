# 脚本定位与命令

规范路径：`comet/reference/scripts.md`

本文件是 Comet 脚本定位和 state/guard/handoff/archive 命令面的单一事实来源。每会话加载一次，然后复用缓存的环境变量。

## 引导（每会话运行一次）

Comet 脚本随 skill 包分发在 `comet/scripts/` 下。**不硬编码路径** — 定位一次，缓存到环境变量。子 Skill 可以直接引用本节，只有需要完全自包含执行时才内联此块；修改时以本文件为单一事实源：

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.mjs' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.mjs not found. Ensure the comet skill is installed." >&2
  return 1
fi
COMET_SCRIPTS_DIR="$(node "$COMET_ENV")"
COMET_STATE="$COMET_SCRIPTS_DIR/comet-state.mjs"
COMET_GUARD="$COMET_SCRIPTS_DIR/comet-guard.mjs"
COMET_HANDOFF="$COMET_SCRIPTS_DIR/comet-handoff.mjs"
COMET_ARCHIVE="$COMET_SCRIPTS_DIR/comet-archive.mjs"
COMET_INTENT="$COMET_SCRIPTS_DIR/comet-intent.mjs"
COMET_RESUME_PROBE="$COMET_SCRIPTS_DIR/comet-resume-probe.mjs"
COMET_KNOWLEDGE="$COMET_SCRIPTS_DIR/comet-knowledge.mjs"

# 脚本定位失败时停止流程
if [ -z "$COMET_SCRIPTS_DIR" ]; then
  echo "ERROR: Comet scripts not found. Ensure the comet skill is installed." >&2
  return 1
fi
```

加载 comet 后，agent 应执行以上变量赋值一次，后续全程复用 `$COMET_GUARD`、`$COMET_STATE`、`$COMET_HANDOFF`、`$COMET_ARCHIVE`、`$COMET_INTENT`、`$COMET_RESUME_PROBE` 和 `$COMET_KNOWLEDGE`。

| 变量 | 用途 |
|------|------|
| `COMET_STATE` | `.comet.yaml` 状态读写、phase 检查和恢复上下文 |
| `COMET_GUARD` | 阶段退出守卫和 `--apply` 状态推进 |
| `COMET_HANDOFF` | Design/Build handoff 上下文包生成 |
| `COMET_ARCHIVE` | 一键归档和主 spec 同步 |
| `COMET_INTENT` | `/comet` 入口意图识别和路由评分 |
| `COMET_RESUME_PROBE` | 只读 Ambient Resume 探针，判断是否应恢复 active Comet workflow |
| `COMET_KNOWLEDGE` | 仓库级 `CODEBASE-KNOWLEDGE.md` 读写，获取已知陷阱和弃用函数 |

## 自动状态更新

guard 支持 `--apply` 参数，验证通过后自动更新 `.comet.yaml` 状态字段：

```bash
node "$COMET_GUARD" <change-name> <phase> --apply
```

`--apply` 内部委托给 `comet-state transition`。需要直接表达状态事件时使用：

```bash
node "$COMET_STATE" transition <change-name> open-complete
node "$COMET_STATE" transition <change-name> design-complete
node "$COMET_STATE" transition <change-name> build-complete
node "$COMET_STATE" transition <change-name> verify-pass
node "$COMET_STATE" transition <change-name> verify-fail
```

归档完成由 `node "$COMET_ARCHIVE" <change-name>` 负责；OpenSpec 会把 change 移到带日期前缀的归档目录，不要手动 transition 一个 `<archive-name>`。

## 仓库知识库

读、追加、清空仓库级别的知识库文件 `CODEBASE-KNOWLEDGE.md`：

```bash
node "$COMET_KNOWLEDGE" get               # 打印当前知识库内容
node "$COMET_KNOWLEDGE" append "<text>"    # 追加新条目（自动加时间戳）
node "$COMET_KNOWLEDGE" clear              # 清空知识库（保留文件头）
```

每条追加自动以 `- [YYYY-MM-DD] ` 开头，方便 agent 构建上下文。

如 `CODEBASE-KNOWLEDGE.md` 尚未存在，第一次 `append` 会自动创建。

## 解析下一步

阶段守卫推进 phase 后，用 `next` 子命令解析是否自动调用下一个 skill：

```bash
node "$COMET_STATE" next <change-name>
```

输出 `NEXT: auto|manual|done` + `SKILL: <skill-name>`（`done` 时省略）+ `HINT`（仅 `manual` 时）。`auto_transition: false` 时输出 `manual`，只暂停下一 skill 调用，不影响已发生的 phase 推进。

## 归档脚本

一键完成归档全部步骤：

```bash
node "$COMET_ARCHIVE" <change-name>
```
