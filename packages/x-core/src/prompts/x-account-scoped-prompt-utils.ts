import type { XAccount } from "../types.js";
import type { AccountScopedXPromptCategory } from "./x-account-scoped-prompts.js";

const ACCOUNT_SCOPED_PROMPT_MARKER = "[X_ACCOUNT_SCOPED_PROMPT]";

type AccountScopedPromptOwner = Pick<XAccount, "id" | "handle" | "name">;

export function buildAccountScopedPromptLabel(
  category: AccountScopedXPromptCategory,
  account: Pick<XAccount, "handle">,
  sourceLabel?: string | null
) {
  const agentName = category === "main" ? "Main Agent" : "Writer Agent";
  return sourceLabel?.trim()
    ? `@${account.handle} dedicated ${agentName} | derived from ${sourceLabel.trim()}`
    : `@${account.handle} dedicated ${agentName}`;
}

export function buildAccountScopedPromptNotes(input: {
  category: AccountScopedXPromptCategory;
  account: AccountScopedPromptOwner;
  sourceLabel?: string | null;
  baseNotes?: string | null;
}) {
  const cleanBaseNotes = stripAccountScopedPromptMetadata(input.baseNotes);
  const details = [
    `category=${input.category}`,
    `accountId=${input.account.id}`,
    `handle=${normalizeMetadataValue(input.account.handle)}`,
    `name=${normalizeMetadataValue(input.account.name)}`
  ];
  const summary = [
    `Account-scoped runtime prompt for @${input.account.handle}.`,
    input.sourceLabel?.trim() ? `Cloned from: ${input.sourceLabel.trim()}` : null,
    cleanBaseNotes || null
  ]
    .filter(Boolean)
    .join("\n");

  return [ACCOUNT_SCOPED_PROMPT_MARKER, ...details, "", summary].join("\n").trim();
}

export function isAccountScopedPromptOwnedByAccount(
  notes: string | null | undefined,
  category: AccountScopedXPromptCategory,
  accountId: string
) {
  const metadata = parseAccountScopedPromptMetadata(notes);
  return metadata?.category === category && metadata.accountId === accountId;
}

export function stripAccountScopedPromptMetadata(notes: string | null | undefined) {
  const normalized = normalizeNotes(notes);
  if (!normalized.startsWith(`${ACCOUNT_SCOPED_PROMPT_MARKER}\n`)) {
    return normalized.trim();
  }

  const lines = normalized.split("\n");
  let index = 1;
  while (index < lines.length && lines[index].trim()) {
    index += 1;
  }

  while (index < lines.length && !lines[index].trim()) {
    index += 1;
  }

  return lines.slice(index).join("\n").trim();
}

export function isAccountScopedPromptVersion(notes: string | null | undefined) {
  return parseAccountScopedPromptMetadata(notes) != null;
}

function parseAccountScopedPromptMetadata(notes: string | null | undefined) {
  const normalized = normalizeNotes(notes);
  if (!normalized.startsWith(`${ACCOUNT_SCOPED_PROMPT_MARKER}\n`)) {
    return null;
  }

  const lines = normalized.split("\n");
  const values = new Map<string, string>();

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      break;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      return null;
    }

    values.set(line.slice(0, separatorIndex), line.slice(separatorIndex + 1));
  }

  const category = values.get("category");
  const accountId = values.get("accountId");
  if ((category !== "main" && category !== "writing") || !accountId) {
    return null;
  }

  return {
    category,
    accountId,
    handle: values.get("handle") ?? "",
    name: values.get("name") ?? ""
  } satisfies {
    category: AccountScopedXPromptCategory;
    accountId: string;
    handle: string;
    name: string;
  };
}

function normalizeMetadataValue(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeNotes(notes: string | null | undefined) {
  return typeof notes === "string" ? notes.replace(/\r\n/g, "\n") : "";
}
