---
name: comet-open
description: "Comet 阶段 1：开启。用 /comet-open 调用。通过 OpenSpec 探索想法、确认需求澄清，再创建 change 结构（proposal + design + tasks）。"
---

# Comet 阶段 1：开启（Open）

## 前置条件

- 无活跃 change，或用户希望创建新 change

## 步骤

### 0. 输出语言约束

传递给 OpenSpec 的所有提问和产物要求都必须包含输出语言约束：使用触发本次工作流的用户请求语言。恢复已有 change 且产物已有明确主语言时，除非用户明确要求切换，否则保持该语言。

### 1. 探索想法与需求澄清

**立即执行：** 使用 Skill 工具加载 `openspec-explore` 技能。禁止跳过此步骤。

技能加载后，按其指引探索问题空间，但不得把一次问答视为足够澄清。必须围绕下列内容继续提问、对齐并形成澄清摘要：
- 目标：用户真正要解决的问题和期望结果
- 非目标：本次明确不做的内容
- 范围边界：涉及/不涉及的模块、用户、平台或数据
- 关键未知项：仍不确定的假设、风险或依赖
- 验收场景草案：至少覆盖核心成功场景和关键边界场景

澄清摘要必须包含：目标、非目标、范围边界、关键未知项、验收场景草案。

### 1a. PRD 拆分预检（阻塞点）

当用户输入是大型 PRD、路线图、完整产品方案，或澄清摘要显示包含多个独立能力、模块、用户路径或里程碑时，必须在创建 OpenSpec artifacts 前评估是否需要拆分为多个 change。

拆分预检必须基于已澄清的信息，输出候选拆分清单。每个候选拆分项必须包含：
- 建议 change 名称
- 目标与范围边界
- 明确非目标
- 依赖关系或推荐执行顺序
- 对应的核心验收场景

满足任一条件时，应推荐拆分：
- PRD 包含多个可独立设计、构建、验证、归档的 capability
- 涉及多个模块或用户路径，且其中一部分可独立交付
- 存在明显分阶段里程碑
- 预计会产生多个 delta spec 或超过 3 个大任务
- 任一部分失败或延期不应阻塞其他部分进入后续阶段

如推荐拆分，按主 skill 阻塞点规则暂停等待用户选择。

用户选择必须包含：
- 「创建多个 OpenSpec changes」— 按候选拆分逐个创建独立 change
- 「保持为一个 change」— 继续单 change 流程，并在 proposal/design/tasks 中记录不拆分原因
- 「调整拆分方案后继续」— 用户说明调整方向后，重新输出候选拆分清单并再次确认

每个被接受的拆分项都必须通过 `/comet-open` 创建独立 change，不得直接调用 `/opsx:new`。`/comet-open` 负责同时创建 OpenSpec artifacts 和 `.comet.yaml`，确保每个 change 都进入 Comet 状态机。

不得在用户完成 PRD 拆分选择前创建 proposal.md、design.md 或 tasks.md。若用户选择创建多个 change，当前 `/comet-open` 调用只负责完成拆分确认与调度，随后按用户确认的顺序分别进入每个拆分项的 `/comet-open`。

批量拆分模式下，进入每个拆分项的 `/comet-open` 时必须明确标注「已确认拆分项」并携带该拆分项的目标、范围、非目标和验收场景。已确认拆分项默认跳过 PRD 拆分预检，除非该拆分项本身仍明显包含多个独立 capability。

批量拆分模式下，单个拆分项完成 open 阶段后不得自动流转到 `/comet-design`。拆分完毕后必须暂停询问用户开始哪一个 change；用户选择后，只推进该 change 进入 `/comet-design`，其他 change 保持 active，稍后通过 `/comet` 恢复。

最小断点恢复规则：不新增专用批量状态文件。若批量拆分过程中断，恢复时先检查已创建的 active changes；已存在且包含 `.comet.yaml` 的拆分项不得重复创建，未创建的拆分项按用户已确认的拆分清单继续通过 `/comet-open` 创建。若对话中已确认的拆分清单不可恢复，必须重新向用户确认拆分清单后再继续。

### 1b. 需求澄清完成确认（阻塞点）

创建 OpenSpec artifacts 前，按主 skill 阻塞点规则暂停等待用户确认需求澄清完成。

暂停时必须展示澄清摘要：目标、非目标、范围边界、关键未知项、验收场景草案。

不得在用户确认需求澄清完成前创建 proposal.md、design.md 或 tasks.md，也不得使用 Skill 工具加载 `openspec-propose` 技能一次性生成全部 artifacts。


### 1c. 预检文档冲突（阻塞点）

创建任何 change artifacts 前，必须运行程序化冲突检查以扫描相关现有文档。检查首先查阅**设计注册表**（`docs/superpowers/INDEX.md`）——所有设计文档的权威索引——然后回退到文件系统扫描。这防止跨 `openspec/changes/` 和 `docs/superpowers/` 的并行重复设计文档。

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"

# 从澄清摘要中提取关键词（change 名称 + 主题名词）
"$COMET_BASH" "$COMET_STATE" conflict-check <proposed-name> <keyword1> <keyword2> ...
```

**关键词提取规则**：从澄清摘要中派生 3-5 个关键词——提议的 change 名称加上核心主题名词（模块名称、功能名称、子系统名称）。不要包含通用词如"add"、"fix"、"update"、"improve"。

**检查优先级**：设计注册表（`docs/superpowers/INDEX.md`）→ 文件系统扫描（`docs/superpowers/specs/`、`docs/superpowers/plans/`、`openspec/changes/` 非归档）。

**当冲突检查返回 1（发现冲突）：**

按主技能阻塞点规则暂停并展示冲突报告，等待用户回复。用户选择必须包括：
- 「继续现有 change」— 中止此新 change，路由到现有 active change
- 「扩展现有设计文档」— 中止此新 change，打开现有设计文档进行编辑
- 「确认无关，创建新的」— 用户明确确认范围无关，使用明显不同的名称继续 Step 2

在用户完成冲突检查选择前，不得创建 proposal.md、design.md 或 tasks.md。

**当冲突检查返回 0（无冲突）：**

正常继续 Step 2。

**创建 change 后**：INDEX.md 由阶段守卫自动同步。当 `guard --apply` 推进 open 阶段时，脚本自动调用 `index-add` 将新 change 添加到「进行中」表。无需手动编辑 INDEX.md。

### 2. 创建 Change 结构 + 初始化状态

**立即执行：** 使用 Skill 工具加载 `openspec-new-change` 技能。禁止跳过此步骤。

完整 `/comet` 流程默认不得使用 Skill 工具加载 `openspec-propose` 技能；只有用户明确要求一次性生成提案和 artifacts 时才允许加载。

技能加载后，按其指引创建 change 骨架，但当 Step 1b 的已确认澄清摘要已存在于对话上下文时，覆盖其"STOP and wait for user direction"行为。

如果用户已确认澄清摘要（Step 1b），直接使用该摘要填充产物内容。如果不存在澄清摘要（边缘情况），回退到技能的默认行为，询问用户。

然后逐个补齐 proposal.md、design.md、tasks.md；每个文档都必须基于已确认的澄清摘要。

#### 产物收敛原则

**通用规则（所有产物适用）**：
- 生成任何产物前，必须先读取项目实际代码——已有文件结构、代码模式、依赖和约定
- 所有产出必须基于项目真实上下文，不得凭模板或通用知识凭空生成
- 实现逻辑用伪代码/逻辑描述代替完整代码，减少 token 消耗

**各文档职责与内容深度**：

| 文档 | 定位 | 内容要求 |
|------|------|----------|
| proposal.md | 纯逻辑层 | 问题背景、目标、范围、非目标。不含代码，对应项目实际模块 |
| design.md | 设计层 | 架构决策、接口签名、数据结构定义、核心逻辑伪代码。接口签名/类型定义该写代码就写代码；实现逻辑用伪代码/逻辑描述 |
| tasks.md | 执行层 | 任务分解，引用具体文件路径和已有接口。实现细节用逻辑描述，但要让执行者能直接动手 |

**命名与范围守卫**：change name 必须使用用户指定或通过当前平台可用的用户输入/确认机制确认的名称，不得自动生成或推断。变更范围必须与用户描述一致，不得自行扩大或缩小。

确认以下产物已创建：

```
openspec/changes/<name>/
├── .openspec.yaml
├── .comet.yaml
├── proposal.md       # Why + What：问题、目标、范围
├── design.md         # How（高层）：架构决策、方案选型
└── tasks.md          # 任务清单（勾选框）
```

创建 `.comet.yaml` 状态文件：

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"

if [ -z "$COMET_STATE" ] || [ -z "$COMET_GUARD" ]; then
  echo "ERROR: Comet scripts not found. Ensure the comet skill is installed." >&2
  return 1
fi

"$COMET_BASH" "$COMET_STATE" init <name> full
```

### 3. 入口状态验证

验证状态机已正确初始化：

```bash
"$COMET_BASH" "$COMET_STATE" check <name> open
```

验证通过后继续 Step 4。验证失败时脚本会输出具体失败原因。

**幂等性**：open 阶段所有操作可安全重复执行。如 `.comet.yaml` 已处于 `phase: open` 且三个产物文件均已存在，跳过已完成步骤，从第一个缺失步骤继续。

### 4. 内容完整性检查

确认三个文档内容完整，符合产物收敛原则中各文档的内容要求：
- **proposal.md**：问题背景、目标、范围、非目标
- **design.md**：架构决策、接口签名、数据结构、核心逻辑伪代码
- **tasks.md**：任务列表，引用具体文件路径和已有接口

**文件存在性验证**：逐个确认三个文件路径存在且非空。任一文件缺失或为空时，不得进入 Step 5 或执行阶段守卫，必须回到创建步骤补充。

### 5. 用户审视确认（阻塞点）

三个文档创建完成且内容完整性检查通过后，按主 skill 阻塞点规则暂停等待用户确认。

用户确认问题必须以单选题形式呈现，包含以下摘要和选项：

**摘要内容**：
- **proposal.md**：问题背景、目标、范围
- **design.md**：高层架构决策、方案选型
- **tasks.md**：任务数量和关键任务描述

**选项**：
- 「确认，继续下一阶段」— 产物符合预期，执行阶段守卫流转
- 「需要调整」— 附带调整说明，修改后重新请求确认

用户选择「确认」后继续执行退出条件。用户选择「需要调整」时，按其说明修改对应文件，然后重新请求确认。

## 退出条件

- proposal.md、design.md、tasks.md 均已创建且内容完整
- **用户已确认** proposal、design、tasks 内容符合预期
- **阶段守卫**：运行 `"$COMET_BASH" "$COMET_GUARD" <change-name> open --apply`，全部 PASS 后由守卫推进到下一阶段（此步骤更新 `phase` 字段，与 `auto_transition` 无关）

退出前必须使用 `--apply`，否则 `.comet.yaml` 仍停留在 `phase: open`，下一阶段入口检查会失败。

```bash
"$COMET_BASH" "$COMET_GUARD" <change-name> open --apply
```

完整流程会自动更新为 `phase: design`；hotfix/tweak preset 会自动更新为 `phase: build`。

## 自动衔接下一阶段

按主 skill「共享规则 → 自动衔接下一阶段」执行。hotfix/tweak preset 由对应 preset skill 控制后续流转（phase 直接进入 build），其 `next` 会返回对应 preset skill。
