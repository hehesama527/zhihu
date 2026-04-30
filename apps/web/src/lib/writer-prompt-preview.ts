import type { AccountListItem, PromptSetView, PromptVersionSummary } from "@zhihu-mvp/shared";

type WriterPromptAccount = Pick<AccountListItem, "name" | "zhihuUserName" | "writerPromptVersionId">;

export function getActiveWriterPromptVersion(writerPromptSet: PromptSetView | null | undefined) {
  if (!writerPromptSet) {
    return null;
  }

  return (
    writerPromptSet.versions.find((version) => version.id === writerPromptSet.activeVersionId) ??
    writerPromptSet.versions[0] ??
    null
  );
}

export function getBoundWriterPromptVersion(
  account: WriterPromptAccount | null | undefined,
  writerPromptSet: PromptSetView | null | undefined
) {
  if (!account?.writerPromptVersionId || !writerPromptSet) {
    return null;
  }

  return writerPromptSet.versions.find((version) => version.id === account.writerPromptVersionId) ?? null;
}

export function getEffectiveWriterPromptVersion(
  account: WriterPromptAccount | null | undefined,
  writerPromptSet: PromptSetView | null | undefined
) {
  return getBoundWriterPromptVersion(account, writerPromptSet) ?? getActiveWriterPromptVersion(writerPromptSet);
}

export function buildWriterPromptSuffixPreview(account: WriterPromptAccount | null | undefined) {
  const personaName = account?.name?.trim();
  if (!personaName) {
    return null;
  }

  const lines = [
    "运行时账号上下文：",
    `1. 当前目标账号 / 人设名是“${personaName}”。如果基础 Prompt 里提到了默认人设名，例如“二牛”，请用当前账号覆盖。`,
    "2. 现在仍处在轻量矩阵测试阶段，不要为了制造表面差异去重写整套风格系统。",
    "3. 主要调整应该放在语气、观察角度和经验框架上，同时保证回答自然、克制、可信。",
    `4. 除非题目确实需要建立可信度，否则不要用“我是${personaName}”这种生硬自我介绍开头。`
  ];

  if (account?.zhihuUserName?.trim()) {
    lines.push(
      `5. 关联的知乎账号名是“${account.zhihuUserName.trim()}”。必要时可以作为语气参考，但不需要强行出现在最终回答里。`
    );
  }

  return lines.join("\n");
}

export function buildEffectiveWriterPrompt(content: string, account: WriterPromptAccount | null | undefined) {
  const trimmedContent = content.trim();
  const suffix = buildWriterPromptSuffixPreview(account);

  if (!trimmedContent) {
    return suffix ?? "";
  }

  return suffix ? `${trimmedContent}\n\n${suffix}` : trimmedContent;
}

export function summarizePrompt(text: string | null | undefined, maxLength = 110) {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "暂无 Prompt 内容";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

export function formatPromptVersion(version: PromptVersionSummary | null | undefined) {
  if (!version) {
    return "暂无可用版本";
  }

  return `v${version.version} / ${version.label} / ${formatVersionStatus(version.status)}`;
}

function formatVersionStatus(status: PromptVersionSummary["status"]) {
  const map: Record<PromptVersionSummary["status"], string> = {
    draft: "草稿",
    active: "生效中",
    archived: "已归档"
  };

  return map[status];
}
