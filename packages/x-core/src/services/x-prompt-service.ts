import { PromptRepository, applySchemaMigrations, getMysqlPool } from "@zhihu-mvp/core";
import {
  getDefaultXPromptSeedByCategory,
  xDefaultPromptSeeds,
  xPromptSetDefinitions
} from "../prompts/x-default-prompts.js";
import type { AccountScopedXPromptCategory } from "../prompts/x-account-scoped-prompts.js";
import {
  buildAccountScopedPromptLabel,
  buildAccountScopedPromptNotes,
  isAccountScopedPromptOwnedByAccount,
  isAccountScopedPromptVersion,
  stripAccountScopedPromptMetadata
} from "../prompts/x-account-scoped-prompt-utils.js";
import type {
  XAccount,
  XAccountPromptPanelView,
  XPromptCategory,
  XPromptDetailView,
  XPromptSetName,
  XPromptTemplateView
} from "../types.js";
import { XLlmService } from "./x-llm-service.js";

type UpsertPromptInput = {
  category: XPromptCategory;
  label: string;
  content: string;
  notes?: string;
  activate?: boolean;
};

export class XPromptService {
  private readonly pool = getMysqlPool();
  private readonly promptRepository = new PromptRepository(this.pool);

  constructor(private readonly llmService: XLlmService) {}

  async bootstrapDefaults() {
    await applySchemaMigrations(this.pool);
    await this.promptRepository.ensurePromptSets(
      xDefaultPromptSeeds.map((seed) => ({
        name: seed.name,
        title: seed.title
      }))
    );

    for (const seed of xDefaultPromptSeeds) {
      const versions = await this.promptRepository.listPromptVersions(seed.name);
      if (versions.length > 0) {
        continue;
      }

      const versionId = await this.promptRepository.createPromptDraft(seed.name, seed.label, seed.content, seed.notes);
      await this.promptRepository.activatePromptVersion(versionId);
    }
  }

  async listPrompts() {
    const prompts = await Promise.all(
      (Object.keys(xPromptSetDefinitions) as XPromptCategory[]).map((category) => this.getPrompt(category))
    );

    return prompts.filter(Boolean) as XPromptTemplateView[];
  }

  async getPrompt(categoryOrSetName: string, options?: { includeAccountScopedVersions?: boolean }) {
    const definition = resolvePromptDefinition(categoryOrSetName);
    if (!definition) {
      return null;
    }

    const includeAccountScopedVersions = options?.includeAccountScopedVersions === true;
    const allVersions = await this.promptRepository.listPromptVersions(definition.name);
    const persistedActiveVersionId = await this.promptRepository.getActivePromptVersionId(definition.name);
    const versions = filterPromptVersions(definition.category, allVersions, includeAccountScopedVersions);
    const versionIds = new Set(versions.map((version) => version.id));
    const testRuns = (await this.promptRepository.listPromptTestRuns(definition.name)).filter((run) =>
      versionIds.has(run.promptVersionId)
    );
    const activeVersion =
      versions.find((version) => version.id === persistedActiveVersionId) ??
      versions.find((version) => version.status === "active") ??
      versions[0] ??
      null;
    const template = activeVersion?.content ?? getDefaultXPromptSeedByCategory(definition.category)?.content ?? "";

    const detail: XPromptDetailView = {
      id: definition.category,
      setName: definition.name,
      name: activeVersion?.label ?? getDefaultXPromptSeedByCategory(definition.category)?.label ?? definition.title,
      description: activeVersion?.notes?.trim() || definition.description,
      category: definition.category,
      template,
      variables: extractVariables(template),
      isActive: Boolean(activeVersion),
      lastTestedAt: testRuns[0]?.createdAt ?? null,
      createdAt: activeVersion?.createdAt ?? "",
      updatedAt: activeVersion?.updatedAt ?? "",
      activeVersionId: activeVersion?.id ?? null,
      activeVersion: activeVersion?.version ?? null,
      activeLabel: activeVersion?.label ?? null,
      versionCount: versions.length,
      versions,
      testRuns
    };

    return detail;
  }

  async createPrompt(input: UpsertPromptInput) {
    const definition = xPromptSetDefinitions[input.category];
    const versionId = await this.promptRepository.createPromptDraft(
      definition.name,
      input.label.trim(),
      input.content.trim(),
      input.notes?.trim() ?? ""
    );

    if (input.activate !== false) {
      await this.promptRepository.activatePromptVersion(versionId);
    }

    const prompt = await this.getPrompt(input.category);
    if (!prompt) {
      throw new Error("Failed to resolve prompt after creating a new version.");
    }

    return prompt;
  }

  async updatePrompt(categoryOrSetName: string, input: Omit<UpsertPromptInput, "category">) {
    const definition = resolvePromptDefinition(categoryOrSetName);
    if (!definition) {
      return null;
    }

    return this.createPrompt({
      category: definition.category,
      label: input.label,
      content: input.content,
      notes: input.notes,
      activate: input.activate
    });
  }

  async testPrompt(categoryOrSetName: string, input: Record<string, unknown>) {
    const definition = resolvePromptDefinition(categoryOrSetName);
    if (!definition) {
      throw new Error("Prompt not found.");
    }

    const detail = await this.getPrompt(definition.category);
    if (!detail?.activeVersionId) {
      throw new Error("No active prompt version available for testing.");
    }

    try {
      const output = await this.llmService.runPrompt(detail.template, input, {
        runtimeTarget: definition.name
      });
      await this.promptRepository.recordPromptTestRun(detail.activeVersionId, JSON.stringify(input), output, null);
      return output;
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "Unknown X prompt test error";
      await this.promptRepository.recordPromptTestRun(detail.activeVersionId, JSON.stringify(input), null, errorText);
      throw error;
    }
  }

  async activatePromptVersion(versionId: number) {
    const version = await this.promptRepository.getPromptVersionById(versionId);
    if (!version) {
      throw new Error("Prompt version not found.");
    }

    if (isAccountScopedPromptVersion(version.notes)) {
      throw new Error("Account-scoped prompt versions cannot be activated as template versions.");
    }

    await this.promptRepository.activatePromptVersion(versionId);

    const prompt = await this.getPrompt(version.set_name as XPromptSetName);
    if (!prompt) {
      throw new Error("Prompt set not found after activation.");
    }

    return prompt;
  }

  async getPromptCategoryForVersion(versionId: number): Promise<XPromptCategory | null> {
    const version = await this.promptRepository.getPromptVersionById(versionId);
    if (!version?.set_name) {
      return null;
    }

    return resolvePromptDefinition(version.set_name)?.category ?? null;
  }

  async ensureAccountScopedPromptBindings(
    account: Pick<XAccount, "id" | "name" | "handle" | "mainPromptVersionId" | "writerPromptVersionId">
  ) {
    const mainPromptVersionId = await this.ensureAccountScopedPromptBinding("main", account, account.mainPromptVersionId);
    const writerPromptVersionId = await this.ensureAccountScopedPromptBinding("writing", account, account.writerPromptVersionId);

    return {
      mainPromptVersionId,
      writerPromptVersionId,
      changed:
        mainPromptVersionId !== account.mainPromptVersionId || writerPromptVersionId !== account.writerPromptVersionId
    };
  }

  async assertAccountScopedPromptVersionOwnership(
    category: AccountScopedXPromptCategory,
    versionId: number,
    account: Pick<XAccount, "id" | "handle">
  ) {
    const definition = xPromptSetDefinitions[category];
    const version = await this.promptRepository.getPromptVersionById(versionId);
    if (!version || version.set_name !== definition.name) {
      throw new Error(`Prompt version #${versionId} does not belong to ${category}.`);
    }

    if (!isAccountScopedPromptOwnedByAccount(version.notes, category, account.id)) {
      throw new Error(
        `Prompt version #${versionId} is not owned by @${account.handle} and cannot be bound to this account.`
      );
    }
  }

  async getAccountScopedPromptPanel(
    category: AccountScopedXPromptCategory,
    account: Pick<XAccount, "id" | "mainPromptVersionId" | "writerPromptVersionId">
  ): Promise<XAccountPromptPanelView> {
    const prompt = await this.getPrompt(category, { includeAccountScopedVersions: true });
    if (!prompt) {
      throw new Error(`Prompt set not found for ${category}.`);
    }

    const boundVersionId = category === "main" ? account.mainPromptVersionId : account.writerPromptVersionId;
    const accountVersions = prompt.versions
      .filter((version) => isAccountScopedPromptOwnedByAccount(version.notes, category, account.id))
      .map((version) => sanitizeAccountPromptVersion(version));
    const boundVersion =
      accountVersions.find((version) => version.id === boundVersionId) ??
      (boundVersionId
        ? (() => {
            const version = prompt.versions.find((item) => item.id === boundVersionId);
            return version ? sanitizeAccountPromptVersion(version) : null;
          })()
        : null);

    return {
      category,
      prompt: {
        ...prompt,
        description: stripAccountScopedPromptMetadata(prompt.description),
        versions: prompt.versions.map((version) => sanitizeAccountPromptVersion(version))
      },
      boundVersionId,
      boundVersion,
      accountVersions
    };
  }

  async createAccountScopedPromptDraft(
    category: AccountScopedXPromptCategory,
    account: Pick<XAccount, "id" | "name" | "handle">,
    input: { label: string; content: string; notes?: string; sourceVersionId?: number | null }
  ) {
    const definition = xPromptSetDefinitions[category];
    const sourceVersion = input.sourceVersionId
      ? await this.promptRepository.getPromptVersionById(input.sourceVersionId)
      : null;

    if (sourceVersion && sourceVersion.set_name !== definition.name) {
      throw new Error(`Source prompt version #${input.sourceVersionId} does not belong to ${category}.`);
    }

    return this.promptRepository.createPromptDraft(
      definition.name,
      input.label.trim(),
      input.content.trim(),
      buildAccountScopedPromptNotes({
        category,
        account,
        sourceLabel: sourceVersion?.label ?? null,
        baseNotes: input.notes?.trim() ?? ""
      })
    );
  }

  async updateAccountScopedPromptDraft(
    category: AccountScopedXPromptCategory,
    versionId: number,
    account: Pick<XAccount, "id" | "name" | "handle">,
    input: { label?: string; content?: string; notes?: string }
  ) {
    await this.assertAccountScopedPromptVersionOwnership(category, versionId, account);
    const version = await this.promptRepository.getPromptVersionById(versionId);
    if (!version) {
      throw new Error(`Prompt version #${versionId} was not found.`);
    }

    await this.promptRepository.updatePromptDraft(versionId, {
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.content !== undefined ? { content: input.content.trim() } : {}),
      ...(input.notes !== undefined
        ? {
            notes: buildAccountScopedPromptNotes({
              category,
              account,
              sourceLabel: version.label,
              baseNotes: input.notes.trim()
            })
          }
        : {})
    });
  }

  private async ensureAccountScopedPromptBinding(
    category: AccountScopedXPromptCategory,
    account: Pick<XAccount, "id" | "name" | "handle">,
    versionId?: number | null
  ) {
    const definition = xPromptSetDefinitions[category];
    const currentVersion = versionId ? await this.promptRepository.getPromptVersionById(versionId) : null;

    if (
      currentVersion?.set_name === definition.name &&
      isAccountScopedPromptOwnedByAccount(currentVersion.notes, category, account.id)
    ) {
      return currentVersion.id;
    }

    const cloneSource =
      currentVersion?.set_name === definition.name && !currentVersion.notes?.includes("[X_ACCOUNT_SCOPED_PROMPT]")
        ? {
            label: currentVersion.label,
            content: currentVersion.content,
            notes: currentVersion.notes ?? ""
          }
        : await resolvePromptVersionSource(this.promptRepository, category);

    return this.promptRepository.createPromptDraft(
      definition.name,
      buildAccountScopedPromptLabel(category, account, cloneSource.label),
      cloneSource.content,
      buildAccountScopedPromptNotes({
        category,
        account,
        sourceLabel: cloneSource.label,
        baseNotes: cloneSource.notes
      })
    );
  }
}

function resolvePromptDefinition(categoryOrSetName: string) {
  const normalized = categoryOrSetName.trim();

  for (const category of Object.keys(xPromptSetDefinitions) as XPromptCategory[]) {
    const definition = xPromptSetDefinitions[category];
    if (normalized === category || normalized === definition.name) {
      return {
        category,
        ...definition
      };
    }
  }

  return null;
}

function extractVariables(template: string) {
  const matches = template.match(/\{(\w+)\}/g);
  if (!matches) {
    return [];
  }

  return matches.map((item) => item.slice(1, -1)).filter((value, index, array) => array.indexOf(value) === index);
}

function filterPromptVersions(
  category: XPromptCategory,
  versions: Awaited<ReturnType<PromptRepository["listPromptVersions"]>>,
  includeAccountScopedVersions: boolean
) {
  if (includeAccountScopedVersions || (category !== "main" && category !== "writing")) {
    return versions;
  }

  return versions.filter((version) => !isAccountScopedPromptVersion(version.notes));
}

async function resolvePromptVersionSource(
  promptRepository: PromptRepository,
  category: XPromptCategory,
  preferredVersionId?: number | null
) {
  const definition = xPromptSetDefinitions[category];

  if (preferredVersionId) {
    const preferredVersion = await promptRepository.getPromptVersionById(preferredVersionId);
    if (preferredVersion?.set_name === definition.name) {
      return {
        label: preferredVersion.label,
        content: preferredVersion.content,
        notes: preferredVersion.notes ?? ""
      };
    }
  }

  const activeVersionId = await promptRepository.getActivePromptVersionId(definition.name);
  if (activeVersionId) {
    const activeVersion = await promptRepository.getPromptVersionById(activeVersionId);
    if (activeVersion?.set_name === definition.name) {
      return {
        label: activeVersion.label,
        content: activeVersion.content,
        notes: activeVersion.notes ?? ""
      };
    }
  }

  const seed = getDefaultXPromptSeedByCategory(category);
  if (!seed) {
    throw new Error(`No default prompt seed configured for ${category}.`);
  }

  return {
    label: seed.label,
    content: seed.content,
    notes: seed.notes
  };
}

function sanitizeAccountPromptVersion(version: Awaited<ReturnType<PromptRepository["listPromptVersions"]>>[number]) {
  return {
    ...version,
    notes: stripAccountScopedPromptMetadata(version.notes)
  };
}
