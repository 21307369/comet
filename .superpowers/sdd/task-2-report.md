## Task 2: Classic Runtime Command And Launcher

### Task 2 commit
- Commit: `1d57c1c6`

### 变更摘要
- 新增 `domains/comet-classic/classic-resume-probe-command.ts` 与 `domains/comet-classic/classic-resume-probe-entry.ts`，实现 `resume-probe` 脚本入口与 JSON/STDIN 解析路径。
- 在 `domains/comet-classic/classic-cli.ts` 注册 `resume-probe` 命令并关联 handler。
- 在 `domains/comet-classic/index.ts` 导出 resume-probe 的域模块、命令和入口文件。
- 在 `config/repository-layout.json` 中补充 classic runtime 命令入口与输出映射。
- 在 `assets/manifest.json` 注册 `comet/scripts/comet-resume-probe.mjs`。
- 生成/更新 `assets/skills/comet/scripts/comet-runtime.mjs` 与 `assets/skills/comet/scripts/comet-resume-probe.mjs`。
- 补充 `test/domains/comet-classic/classic-resume-probe-command.test.ts`。
- 扩展 `test/domains/comet-classic/comet-scripts.test.ts` 的 launcher 薄封装与脚本列表校验。

### 命令与结果
- `npx vitest run test/domains/comet-classic/classic-resume-probe-command.test.ts test/domains/comet-classic/comet-scripts.test.ts`
  - 初次在 `resume-probe` 映射未对齐时失败：
    - `FAIL test/domains/comet-classic/comet-scripts.test.ts`
    - 断言期望 `main(["resumeProbe", ...])`，实际文件为 `main(["resume-probe", ...])`。
  - 修正 `comet-scripts.test.ts` 的命令映射与脚本 key 后再次执行：
    - `Test Files 2 passed`
    - `Tests 164 passed (164)`
- `node scripts/build/build-classic-runtime.mjs`
  - 生成 `comet-resume-probe.mjs`，并同步 runtime bundle。

### 关注项
- 该任务按 Brief 要求使用 `resume-probe` 命令名，当前与 `build-classic-runtime.mjs` 命令命名规则一致；而 `config/repository-layout.json` 中该 key 采用 `resume-probe`，与 repository-layout 中历史的 `resumeProbe` 命名有轻微差异（为匹配真实 launcher 命令名有意保留）。
- `comet-runtime.mjs` 为大文件重生成，diff 中包含与构建器路径拼接变量名变更相关的差异，属于构建产物同步副作用，运行时行为以实际命令链路测试为准。

### 待补充
- 以上变更尚未合并到 Changelog（按本任务规则与范围不要求）。

### 后续补充（2026-07-09）
- 复核到报告中 `Task 2 commit` 的哈希与当前仓库历史不一致：文件仍写 `1d57c1c6`，而仓库中对应提交为 `7650a9f9`。
- 本次修复提交（当前提交）用于弥合 review 复核差异、补齐测试场景与 EOF 空白问题，并在此补充了说明。
