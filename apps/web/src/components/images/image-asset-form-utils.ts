"use client";

import type { Dispatch, SetStateAction } from "react";
import type {
  ImageAssetDetail,
  ImageEmotionTag,
  ImageEntityCategory,
  ImageEntityTag,
  ImageWeightedTag,
  UpdateImageAssetInput
} from "@zhihu-mvp/shared";

export type ImageAssetEditorFormState = {
  ocrText: string;
  anchorKeyword: string;
  captionShort: string;
  captionLong: string;
  assetType: string;
  platformScope: string;
  usageScope: string;
  manualCaption: string;
  entityTags: string;
  topicTags: string;
  emotionTags: string;
  sceneTags: string;
  styleTags: string;
  riskLevel: string;
  riskNotes: string;
  copyrightSource: string;
  status: string;
};

export type ImageAssetUpdatePayload = UpdateImageAssetInput;

export function buildImageAssetEditorForm(asset: ImageAssetDetail): ImageAssetEditorFormState {
  return {
    ocrText: asset.ocrText ?? "",
    anchorKeyword: asset.anchorKeyword ?? "",
    captionShort: asset.captionShort ?? asset.autoCaption ?? "",
    captionLong: asset.captionLong ?? "",
    assetType: asset.assetType,
    platformScope: asset.platformScope,
    usageScope: asset.usageScope,
    manualCaption: asset.manualCaption ?? "",
    entityTags: formatEntityTagsForInput(asset.entityTags),
    topicTags: formatWeightedTagsForInput(asset.topicTags),
    emotionTags: formatEmotionTagsForInput(asset.emotionTags),
    sceneTags: formatWeightedTagsForInput(asset.sceneTags),
    styleTags: formatWeightedTagsForInput(asset.styleTags),
    riskLevel: asset.riskLevel,
    riskNotes: asset.riskNotes ?? "",
    copyrightSource: asset.copyrightSource ?? "",
    status: asset.status
  };
}

export function buildImageAssetUpdatePayload(
  asset: ImageAssetDetail,
  form: ImageAssetEditorFormState
): ImageAssetUpdatePayload {
  const payload: ImageAssetUpdatePayload = {};
  const nextOcrText = normalizeTextInput(form.ocrText);
  const nextAnchorKeyword = normalizeTextInput(form.anchorKeyword);
  const nextCaptionShort = normalizeTextInput(form.captionShort);
  const nextCaptionLong = normalizeTextInput(form.captionLong);
  const nextManualCaption = normalizeTextInput(form.manualCaption);
  const nextRiskNotes = normalizeTextInput(form.riskNotes);
  const nextCopyrightSource = normalizeTextInput(form.copyrightSource);
  const nextEntityTags = parseEntityTagsInput(form.entityTags);
  const nextTopicTags = parseWeightedTagsInput(form.topicTags);
  const nextEmotionTags = parseEmotionTagsInput(form.emotionTags);
  const nextSceneTags = parseWeightedTagsInput(form.sceneTags);
  const nextStyleTags = parseWeightedTagsInput(form.styleTags);

  if (nextOcrText !== normalizeTextInput(asset.ocrText)) {
    payload.ocrText = nextOcrText;
  }

  if (nextAnchorKeyword !== normalizeTextInput(asset.anchorKeyword)) {
    payload.anchorKeyword = nextAnchorKeyword;
  }

  if (nextCaptionShort !== normalizeTextInput(asset.captionShort ?? asset.autoCaption)) {
    payload.captionShort = nextCaptionShort;
  }

  if (nextCaptionLong !== normalizeTextInput(asset.captionLong)) {
    payload.captionLong = nextCaptionLong;
  }

  if (form.assetType !== asset.assetType) {
    payload.assetType = form.assetType as ImageAssetDetail["assetType"];
  }

  if (form.platformScope !== asset.platformScope) {
    payload.platformScope = form.platformScope as ImageAssetDetail["platformScope"];
  }

  if (form.usageScope !== asset.usageScope) {
    payload.usageScope = form.usageScope as ImageAssetDetail["usageScope"];
  }

  if (nextManualCaption !== normalizeTextInput(asset.manualCaption)) {
    payload.manualCaption = nextManualCaption;
  }

  if (!equalEntityTags(nextEntityTags, asset.entityTags)) {
    payload.entityTags = nextEntityTags;
  }

  if (!equalWeightedTags(nextTopicTags, asset.topicTags)) {
    payload.topicTags = nextTopicTags;
  }

  if (!equalEmotionTags(nextEmotionTags, asset.emotionTags)) {
    payload.emotionTags = nextEmotionTags;
  }

  if (!equalWeightedTags(nextSceneTags, asset.sceneTags)) {
    payload.sceneTags = nextSceneTags;
  }

  if (!equalWeightedTags(nextStyleTags, asset.styleTags)) {
    payload.styleTags = nextStyleTags;
  }

  if (form.riskLevel !== asset.riskLevel) {
    payload.riskLevel = form.riskLevel as ImageAssetDetail["riskLevel"];
  }

  if (nextRiskNotes !== normalizeTextInput(asset.riskNotes)) {
    payload.riskNotes = nextRiskNotes;
  }

  if (nextCopyrightSource !== normalizeTextInput(asset.copyrightSource)) {
    payload.copyrightSource = nextCopyrightSource;
  }

  if (form.status !== asset.status) {
    payload.status = form.status as ImageAssetDetail["status"];
  }

  return payload;
}

export function updateImageAssetEditorForm<K extends keyof ImageAssetEditorFormState>(
  setForm: Dispatch<SetStateAction<ImageAssetEditorFormState | null>>,
  key: K,
  value: ImageAssetEditorFormState[K]
) {
  setForm((current) => (current ? { ...current, [key]: value } : current));
}

export function formatImageAssetTags(values?: Array<{ label?: string; name?: string } | string>) {
  const labels = extractTagLabels(values);
  return labels.length ? labels.join(" / ") : "无";
}

export function formatWeightedTagsDetailed(values?: ImageWeightedTag[]) {
  if (!values?.length) {
    return "无";
  }

  return values
    .map((tag) => `${tag.label}（置信 ${tag.confidence} / 权重 ${tag.importance}）`)
    .join(" / ");
}

export function formatEmotionTagsDetailed(values?: ImageEmotionTag[]) {
  if (!values?.length) {
    return "无";
  }

  return values
    .map((tag) => `${tag.label}（置信 ${tag.confidence} / 强度 ${tag.intensity}）`)
    .join(" / ");
}

export function formatEntityTagsDetailed(values?: ImageEntityTag[]) {
  if (!values?.length) {
    return "无";
  }

  return values
    .map((tag) => `${tag.name}（${tag.category} / 置信 ${tag.confidence}）`)
    .join(" / ");
}

export function extractTagLabels(values?: Array<{ label?: string; name?: string } | string>) {
  return (values ?? [])
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }

      return (item.label ?? item.name ?? "").trim();
    })
    .filter(Boolean);
}

function formatEntityTagsForInput(values: ImageEntityTag[]) {
  return values.map((tag) => `${tag.name}|${tag.category}`).join(", ");
}

function formatWeightedTagsForInput(values: ImageWeightedTag[]) {
  return values.map((tag) => tag.label).join(", ");
}

function formatEmotionTagsForInput(values: ImageEmotionTag[]) {
  return values.map((tag) => tag.label).join(", ");
}

function parseEntityTagsInput(value: string): ImageEntityTag[] {
  return Array.from(
    new Map(
      splitInputTokens(value).map((token, index) => {
        const [rawName, rawCategory] = token.split("|").map((item) => item.trim());
        const name = rawName ?? "";
        const category = normalizeEntityCategory(rawCategory);
        return [
          `${name.toLowerCase()}::${category}`,
          {
            name,
            category,
            confidence: Math.max(70, 100 - index * 5)
          }
        ] as const;
      })
    ).values()
  );
}

function parseWeightedTagsInput(value: string): ImageWeightedTag[] {
  return splitInputTokens(value).map((label, index) => ({
    label,
    confidence: Math.max(70, 100 - index * 4),
    importance: Math.max(60, 100 - index * 6)
  }));
}

function parseEmotionTagsInput(value: string): ImageEmotionTag[] {
  return splitInputTokens(value).map((label, index) => ({
    label,
    confidence: Math.max(70, 100 - index * 4),
    intensity: Math.max(60, 100 - index * 8)
  }));
}

function splitInputTokens(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,\n，、/]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function normalizeEntityCategory(value: string | undefined): ImageEntityCategory {
  if (
    value === "ip_character"
    || value === "meme_archetype"
    || value === "brand_mascot"
    || value === "public_figure"
  ) {
    return value;
  }

  return "other";
}

function normalizeTextInput(value: string | null | undefined) {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function equalWeightedTags(left: ImageWeightedTag[], right: ImageWeightedTag[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => item.label === right[index]?.label);
}

function equalEmotionTags(left: ImageEmotionTag[], right: ImageEmotionTag[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => item.label === right[index]?.label);
}

function equalEntityTags(left: ImageEntityTag[], right: ImageEntityTag[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (item, index) =>
      item.name === right[index]?.name
      && item.category === right[index]?.category
  );
}
