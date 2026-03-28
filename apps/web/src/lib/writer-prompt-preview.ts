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
    "Runtime account context:",
    `1. The current target account/persona name is "${personaName}". If the base prompt mentions a default persona name such as "二牛", override it with this account.`,
    "2. This is still the lightweight matrix-testing phase. Do not rewrite the whole style system just to create superficial differences between accounts.",
    "3. The main adjustment should happen in tone, observation angle and experience framing, while the answer still needs to feel natural, restrained and believable.",
    `4. Unless the topic truly needs a credibility setup, do not open the answer with a rigid self-introduction like "我是${personaName}".`
  ];

  if (account?.zhihuUserName?.trim()) {
    lines.push(
      `5. The linked Zhihu username is "${account.zhihuUserName.trim()}". It can be used as a tone reference when needed, but it does not need to appear in the final answer.`
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

  return `v${version.version} / ${version.label} / ${version.status}`;
}
