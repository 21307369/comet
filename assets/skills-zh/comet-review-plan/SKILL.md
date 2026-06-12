---
name: comet-review-plan
description: "独立审查 spec 和 plan。用 /comet-review-plan 调用。通过全新 context 的子代理发现同源偏差，支持 plan-only 和 spec+plan 两种模式。"
---

# 独立审查 Spec 和 Plan（Review Plan）

## 目的

在 build 阶段 plan 生成后、执行前，通过**全新 context 的独立子代理**审查 spec 和 plan，打破同源性偏差——原流程中 proposal → design → tasks → plan 由同一会话产出，容易"一致地错但看起来自洽"。

## 前置条件

- 活跃 change 存在
- Plan 文件已生成（`docs/superpowers/plans/` 下有对应文件）
- 当前处于 build 阶段

## 审查模式

| 模式 | 审查范围 | 适用场景 |
|------|---------|---------|
| `spec+plan`（默认） | OpenSpec 产物 + Design Doc + Plan | 默认模式。检查 spec 内部一致性 + plan 可执行性 |
| `plan-only` | 仅 Plan + 相关代码 | spec 已过多轮审查确认的场景（如从已有 change 恢复） |

## 步骤

### 1. 确定审查模式和输入

读取 `.comet.yaml` 获取 change 信息：

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"
```

收集审查所需文件路径：
- **spec+plan 模式**：`proposal.md`、`design.md`、`tasks.md`、delta specs（`specs/*/spec.md`）、Design Doc（`design_doc` 字段）、Plan 文件（`plan` 字段）
- **plan-only 模式**：Design Doc、Plan 文件、tasks.md

### 2. 派发审查子代理

使用当前平台的 subagent 调度机制派发审查任务。**子代理必须在全新 context 中启动**，不得继承主会话的对话历史。

**子代理指令**：

你是独立的 spec 和 plan 审查专家。你与生成这些文档的 agent 无关，你的任务是从全新视角发现文档中的问题。

**审查模式**：`<spec+plan|plan-only>`

**输入文件**：
- Change 名称：`<name>`
- proposal.md：`<path>`（仅 spec+plan 模式）
- design.md：`<path>`（仅 spec+plan 模式）
- tasks.md：`<path>`（仅 spec+plan 模式）
- Delta specs：`<paths>`（仅 spec+plan 模式）
- Design Doc：`<path>`
- Plan 文件：`<path>`

**审查维度**（按优先级排序）：

1. **方向正确性**（仅 spec+plan 模式）：
   - proposal.md 的目标是否清晰、无歧义？
   - design.md 的架构决策是否合理？是否有更简单的方案被忽略？
   - delta spec 的验收场景是否覆盖了 proposal 的核心目标？
   - 是否存在隐含假设（文档中未说明但执行时必须知道的前提）？

2. **完整性**：
   - spec+plan 模式：spec 中的每个验收场景，plan 是否都有对应 task 覆盖？
   - plan-only 模式：Design Doc 中的每个技术决策，plan 是否都有对应实现步骤？
   - 是否有遗漏的边界条件、错误处理、或数据迁移步骤？

3. **可执行性**：
   - plan 中的每个 task，仅凭当前文档（不依赖对话上下文）能否独立理解要做什么？
   - task 引用的文件路径和接口是否真实存在？（读取项目代码验证）
   - task 之间的依赖顺序是否合理？

4. **一致性**：
   - plan 中的接口签名/数据流是否与项目现有代码模式一致？
   - 各文档之间是否存在矛盾描述？
   - 命名是否一致（同一概念在不同文档中是否用了不同名称）？

5. **风险识别**：
   - 是否有高风险 task（涉及并发、数据迁移、外部依赖）缺少回退方案？
   - 是否有 task 的改动范围超出预期（可能影响其他模块）？

**输出要求**：

审查结果必须以 JSON 格式写入文件 `openspec/changes/<name>/.comet/review-plan.json`。

JSON schema：

```json
{
  "mode": "spec+plan | plan-only",
  "round": 1,
  "status": "pass | fail",
  "findings": [
    {
      "id": 1,
      "severity": "CRITICAL | WARNING | SUGGESTION",
      "dimension": "方向正确性 | 完整性 | 可执行性 | 一致性 | 风险识别",
      "title": "简短描述",
      "detail": "具体问题和位置",
      "suggestion": "建议的修复方式"
    }
  ],
  "summary": "整体评价摘要"
}
```

**严重级别定义**：
- `CRITICAL`：方向性错误或重大遗漏，必须修复后才能执行（如 spec 目标理解错误、核心验收场景无对应 task）
- `WARNING`：可能导致执行偏差，建议修复（如隐含假设未写明、task 依赖顺序不合理）
- `SUGGESTION`：改进建议，不阻塞执行（如命名不一致、可优化的接口设计）

**判定规则**：
- 存在任何 `CRITICAL` → `status: "fail"`
- 仅有 `WARNING` 和/或 `SUGGESTION` → `status: "pass"`（但在 findings 中列出所有 WARNING）

**重要**：
- 你必须实际读取项目代码来验证 plan 中引用的文件路径和接口是否存在
- 不要仅凭文档内容判断，要结合代码上下文
- 如果某个审查维度没有问题，在 findings 中不包含该维度的条目即可
- 审查结果写入文件后，返回文件路径和 status

### 3. 处理审查结果

子代理完成后，读取 `openspec/changes/<name>/.comet/review-plan.json`。

**`status: "pass"`**：审查通过。向用户报告审查结果摘要（findings 数量、WARNING 列表），然后继续后续流程。WARNING 和 SUGGESTION 由用户决定是否采纳。

**`status: "fail"`**：存在 CRITICAL 问题。进入修复循环。

### 4. 修复循环（最多 3 轮）

当审查结果为 `fail` 时：

1. 向用户展示 CRITICAL findings 列表
2. 在主会话中根据 findings 修改对应的 spec/plan 文件
3. 修改完成后，重新派发审查子代理（Step 2），`round` 递增
4. 子代理重新审查，输出新的 review-plan.json

**循环终止条件**：
- 子代理返回 `status: "pass"` → 退出循环，继续后续流程
- 达到 3 轮上限 → 停止循环，将所有未解决的 CRITICAL findings 列出来，按主 skill 阻塞点规则暂停等待用户裁决：
  - 选项 A：「继续修复」— 再给一轮修复机会
  - 选项 B：「接受风险继续」— 记录接受原因，继续后续流程
  - 选项 C：「回退到设计阶段」— 问题过于根本，需要重新 brainstorming

**每轮修复要求**：
- 必须处理所有 CRITICAL findings
- WARNING findings 可选择性处理，未处理的在修复说明中记录原因
- 修改后提交 commit，message 格式：`review: round <N> fixes for <change-name>`

### 5. 审查结果持久化

审查完成后，确保以下文件存在：
- `openspec/changes/<name>/.comet/review-plan.json` — 最终一轮的审查结果

在 tasks.md 末尾追加审查记录：

```markdown
<!-- review-plan: status=<pass|fail> rounds=<N> date=<YYYY-MM-DD> -->
```

## 退出条件

- 审查子代理返回 `status: "pass"`，或用户选择接受风险
- `review-plan.json` 已写入
- tasks.md 已追加审查记录
- 所有 CRITICAL findings 已修复或用户已明确接受

## 降级处理

- 若当前平台无 subagent 调度能力，降级为在主会话中执行审查（效果减弱，因为共享上下文）
- 降级时向用户说明：「当前平台不支持独立子代理，审查将在主会话中执行，独立性保障会降低」
- 降级模式下审查维度和输出格式不变
