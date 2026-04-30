import type { XPromptCategory, XPromptSetName } from "../types.js";

export const ACCOUNT_SCOPED_X_PROMPT_CATEGORIES = ["main", "writing"] as const satisfies readonly XPromptCategory[];
export type AccountScopedXPromptCategory = (typeof ACCOUNT_SCOPED_X_PROMPT_CATEGORIES)[number];

export const ACCOUNT_SCOPED_X_PROMPT_SET_NAMES = ["x_main_agent", "x_writer_agent"] as const satisfies readonly XPromptSetName[];
export type AccountScopedXPromptSetName = (typeof ACCOUNT_SCOPED_X_PROMPT_SET_NAMES)[number];

export function isAccountScopedXPromptCategory(value: XPromptCategory): value is AccountScopedXPromptCategory {
  return ACCOUNT_SCOPED_X_PROMPT_CATEGORIES.includes(value as AccountScopedXPromptCategory);
}

export function isAccountScopedXPromptSetName(value: XPromptSetName): value is AccountScopedXPromptSetName {
  return ACCOUNT_SCOPED_X_PROMPT_SET_NAMES.includes(value as AccountScopedXPromptSetName);
}
