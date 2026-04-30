import { PromptRepository, applySchemaMigrations, getMysqlPool } from "@zhihu-mvp/core";
import {
  getDefaultXTraditionalPromptSeedByCategory,
  xTraditionalDefaultPromptSeeds,
  xTraditionalPromptSetDefinitions
} from "../prompts/x-traditional-default-prompts.js";
import type {
  XTraditionalPromptCategory,
  XTraditionalPromptDetailView,
  XTraditionalPromptSetName,
  XTraditionalPromptTemplateView
} from "../types.js";
import { XTraditionalLlmService } from "./x-traditional-llm-service.js";

type UpsertPromptInput = {
  category: XTraditionalPromptCategory;
  label: string;
  content: string;
  notes?: string;
  activate?: boolean;
};

export class XTraditionalPromptService {
  private readonly pool = getMysqlPool();
  private readonly promptRepository = new PromptRepository(this.pool);

  constructor(private readonly llmService: XTraditionalLlmService) {}

  async bootstrapDefaults() {
    await applySchemaMigrations(this.pool);
    await this.promptRepository.ensurePromptSets(
      xTraditionalDefaultPromptSeeds.map((seed) => ({
        name: seed.name,
        title: seed.title
      }))
    );

    for (const seed of xTraditionalDefaultPromptSeeds) {
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
      (Object.keys(xTraditionalPromptSetDefinitions) as XTraditionalPromptCategory[]).map((category) =>
        this.getPrompt(category)
      )
    );

    return prompts.filter(Boolean) as XTraditionalPromptTemplateView[];
  }

  async getPrompt(categoryOrSetName: string) {
    const definition = resolvePromptDefinition(categoryOrSetName);
    if (!definition) {
      return null;
    }

    const versions = await this.promptRepository.listPromptVersions(definition.name);
    const persistedActiveVersionId = await this.promptRepository.getActivePromptVersionId(definition.name);
    const testRuns = await this.promptRepository.listPromptTestRuns(definition.name);
    const activeVersion =
      versions.find((version) => version.id === persistedActiveVersionId) ??
      versions.find((version) => version.status === "active") ??
      versions[0] ??
      null;
    const seed = getDefaultXTraditionalPromptSeedByCategory(definition.category);
    const template = activeVersion?.content ?? seed?.content ?? "";

    const detail: XTraditionalPromptDetailView = {
      id: definition.category,
      setName: definition.name,
      name: activeVersion?.label ?? seed?.label ?? definition.title,
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
    const definition = xTraditionalPromptSetDefinitions[input.category];
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
      throw new Error("Failed to resolve traditional prompt after creating a new version.");
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
      throw new Error("Traditional prompt not found.");
    }

    const detail = await this.getPrompt(definition.category);
    if (!detail?.activeVersionId) {
      throw new Error("No active traditional prompt version available for testing.");
    }

    try {
      const output = await this.llmService.runPrompt(detail.template, input, {
        runtimeTarget: "x"
      });
      await this.promptRepository.recordPromptTestRun(detail.activeVersionId, JSON.stringify(input), output, null);
      return output;
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "Unknown X traditional prompt test error";
      await this.promptRepository.recordPromptTestRun(detail.activeVersionId, JSON.stringify(input), null, errorText);
      throw error;
    }
  }

  async activatePromptVersion(versionId: number) {
    const version = await this.promptRepository.getPromptVersionById(versionId);
    if (!version) {
      throw new Error("Traditional prompt version not found.");
    }

    const promptSetName = version.set_name;
    if (!promptSetName) {
      throw new Error(`Prompt version #${versionId} has no prompt set binding.`);
    }

    if (!Object.values(xTraditionalPromptSetDefinitions).some((definition) => definition.name === promptSetName)) {
      throw new Error(`Prompt version #${versionId} does not belong to the traditional X module.`);
    }

    await this.promptRepository.activatePromptVersion(versionId);

    const prompt = await this.getPrompt(promptSetName);
    if (!prompt) {
      throw new Error("Traditional prompt set not found after activation.");
    }

    return prompt;
  }
}

function resolvePromptDefinition(categoryOrSetName: string) {
  const normalized = categoryOrSetName.trim();

  for (const category of Object.keys(xTraditionalPromptSetDefinitions) as XTraditionalPromptCategory[]) {
    const definition = xTraditionalPromptSetDefinitions[category];
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
