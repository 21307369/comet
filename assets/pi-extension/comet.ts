import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Detect language from installed SKILL.md content.
 * Falls back to ~/.pi/settings.json locale, then OS locale.
 */
function detectLanguage(): "zh" | "en" {
  // Check installed SKILL.md content — the file is installed from
  // skills-zh/ (Chinese) or skills/ (English) by `comet init`.
  const candidates = [
    join(homedir(), ".agents", "skills", "comet", "SKILL.md"), // pi global
    join("skills", "comet", "SKILL.md"), // project local
  ];
  for (const skillPath of candidates) {
    try {
      if (existsSync(skillPath)) {
        const content = readFileSync(skillPath, "utf-8").slice(0, 500);
        // CJK Unified Ideographs range
        if (/[\u4e00-\u9fff]/.test(content)) return "zh";
        return "en";
      }
    } catch {
      // ignore, try next
    }
  }

  // Fallback: pi settings locale
  try {
    const piSettingsPath = join(homedir(), ".pi", "settings.json");
    if (existsSync(piSettingsPath)) {
      const settings = JSON.parse(readFileSync(piSettingsPath, "utf-8"));
      if (settings.locale?.startsWith("zh")) return "zh";
    }
  } catch {
    // ignore
  }

  // Fallback: OS locale
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || "en";
  return locale.startsWith("zh") ? "zh" : "en";
}

const I18N = {
  zh: {
    comet: {
      description: "OpenSpec + Superpowers 双星开发流程。自动检测阶段并分发到子命令。",
      notify: (msg: string) => `正在启动 Comet 工作流：${msg}`,
      defaultMsg: "开始新的变更",
    },
    hotfix: {
      description: "快速修复（跳过头脑风暴和设计）",
      notify: (msg: string) => `正在启动 Comet 快速修复：${msg}`,
      defaultMsg: "修复一个 bug",
    },
    tweak: {
      description: "小改动（跳过头脑风暴、设计和计划）",
      notify: (msg: string) => `正在启动 Comet 小改动：${msg}`,
      defaultMsg: "做一个小改动",
    },
    open: {
      description: "阶段 1：开启。探索想法、澄清需求，创建 change 结构。",
      notify: (msg: string) => `正在打开 Comet 变更：${msg}`,
      defaultMsg: "开启新变更",
    },
    design: {
      description: "阶段 2：深度设计。通过 brainstorming 产出 Design Doc 和 delta spec。",
      notify: (msg: string) => `正在启动 Comet 深度设计：${msg}`,
      defaultMsg: "开始设计",
    },
    build: {
      description: "阶段 3：计划与构建。制定计划并实施。",
      notify: (msg: string) => `正在启动 Comet 计划与构建：${msg}`,
      defaultMsg: "开始构建",
    },
    verify: {
      description: "阶段 4：验证与收尾。验证实现符合设计，处理开发分支。",
      notify: (msg: string) => `正在启动 Comet 验证：${msg}`,
      defaultMsg: "开始验证",
    },
    archive: {
      description: "阶段 5：归档。合并 delta spec 到主 spec，归档 change。",
      notify: (msg: string) => `正在归档 Comet 变更：${msg}`,
      defaultMsg: "归档变更",
    },
  },
  en: {
    comet: {
      description: "OpenSpec + Superpowers dual-star workflow. Auto-detect phase and dispatch.",
      notify: (msg: string) => `Starting Comet workflow: ${msg}`,
      defaultMsg: "Start a new change",
    },
    hotfix: {
      description: "Quick bug fix (skip brainstorming and design)",
      notify: (msg: string) => `Starting Comet hotfix: ${msg}`,
      defaultMsg: "Fix a bug",
    },
    tweak: {
      description: "Small change (skip brainstorming, design, and plan)",
      notify: (msg: string) => `Starting Comet tweak: ${msg}`,
      defaultMsg: "Make a small change",
    },
    open: {
      description: "Phase 1: Open. Explore ideas, clarify requirements, create change structure.",
      notify: (msg: string) => `Opening Comet change: ${msg}`,
      defaultMsg: "Open a new change",
    },
    design: {
      description: "Phase 2: Deep design. Brainstorm to produce Design Doc and delta spec.",
      notify: (msg: string) => `Starting Comet deep design: ${msg}`,
      defaultMsg: "Start design",
    },
    build: {
      description: "Phase 3: Plan and build. Create plan and implement changes.",
      notify: (msg: string) => `Starting Comet plan and build: ${msg}`,
      defaultMsg: "Start building",
    },
    verify: {
      description: "Phase 4: Verify and close. Verify implementation matches design.",
      notify: (msg: string) => `Starting Comet verify: ${msg}`,
      defaultMsg: "Start verification",
    },
    archive: {
      description: "Phase 5: Archive. Merge delta spec into main spec, archive change.",
      notify: (msg: string) => `Archiving Comet change: ${msg}`,
      defaultMsg: "Archive change",
    },
  },
} as const;

export default function (pi: ExtensionAPI) {
  const lang = detectLanguage();
  const t = I18N[lang];

  pi.registerCommand("comet", {
    description: t.comet.description,
    handler: async (args, ctx) => {
      const message = args?.trim() || t.comet.defaultMsg;
      ctx.ui.notify(t.comet.notify(message), "info");
      pi.sendUserMessage(`/skill:comet ${message}`);
    },
  });

  pi.registerCommand("comet-hotfix", {
    description: t.hotfix.description,
    handler: async (args, ctx) => {
      const message = args?.trim() || t.hotfix.defaultMsg;
      ctx.ui.notify(t.hotfix.notify(message), "info");
      pi.sendUserMessage(`/skill:comet-hotfix ${message}`);
    },
  });

  pi.registerCommand("comet-tweak", {
    description: t.tweak.description,
    handler: async (args, ctx) => {
      const message = args?.trim() || t.tweak.defaultMsg;
      ctx.ui.notify(t.tweak.notify(message), "info");
      pi.sendUserMessage(`/skill:comet-tweak ${message}`);
    },
  });

  pi.registerCommand("comet-open", {
    description: t.open.description,
    handler: async (args, ctx) => {
      const message = args?.trim() || t.open.defaultMsg;
      ctx.ui.notify(t.open.notify(message), "info");
      pi.sendUserMessage(`/skill:comet-open ${message}`);
    },
  });

  pi.registerCommand("comet-design", {
    description: t.design.description,
    handler: async (args, ctx) => {
      const message = args?.trim() || t.design.defaultMsg;
      ctx.ui.notify(t.design.notify(message), "info");
      pi.sendUserMessage(`/skill:comet-design ${message}`);
    },
  });

  pi.registerCommand("comet-build", {
    description: t.build.description,
    handler: async (args, ctx) => {
      const message = args?.trim() || t.build.defaultMsg;
      ctx.ui.notify(t.build.notify(message), "info");
      pi.sendUserMessage(`/skill:comet-build ${message}`);
    },
  });

  pi.registerCommand("comet-verify", {
    description: t.verify.description,
    handler: async (args, ctx) => {
      const message = args?.trim() || t.verify.defaultMsg;
      ctx.ui.notify(t.verify.notify(message), "info");
      pi.sendUserMessage(`/skill:comet-verify ${message}`);
    },
  });

  pi.registerCommand("comet-archive", {
    description: t.archive.description,
    handler: async (args, ctx) => {
      const message = args?.trim() || t.archive.defaultMsg;
      ctx.ui.notify(t.archive.notify(message), "info");
      pi.sendUserMessage(`/skill:comet-archive ${message}`);
    },
  });
}
