import type { ImageAssetDetail } from "@zhihu-mvp/shared";
import {
  formatEmotionTagsDetailed,
  formatEntityTagsDetailed,
  formatImageAssetTags,
  formatWeightedTagsDetailed
} from "./image-asset-form-utils";

export function ImageAnalysisSuggestionPanel({ asset }: { asset: ImageAssetDetail }) {
  const suggestion = asset.analysisSuggestion;

  return (
    <div className="stack stack--tight">
      <strong>自动分析建议</strong>
      <p className="helper-text">OCR：{suggestion?.ocrText || asset.ocrText || "无"}</p>
      <p className="helper-text">主关键词：{suggestion?.anchorKeyword?.label || asset.anchorKeyword || "无"}</p>
      <p className="helper-text">短描述：{suggestion?.captionShort || asset.captionShort || asset.autoCaption || "无"}</p>
      <p className="helper-text">长描述：{suggestion?.captionLong || asset.captionLong || "无"}</p>
      <p className="helper-text">类型建议：{suggestion ? formatAssetType(suggestion.assetType) : "无"}</p>
      <p className="helper-text">平台建议：{suggestion ? formatPlatformScope(suggestion.platformScope) : "无"}</p>
      <p className="helper-text">用途建议：{suggestion ? formatUsageScope(suggestion.usageScope) : "无"}</p>
      <p className="helper-text">含字判断：{suggestion ? (suggestion.hasText ? "是" : "否") : asset.hasText ? "是" : "否"}</p>
      <p className="helper-text">实体建议：{formatEntityTagsDetailed(suggestion?.entityTags)}</p>
      <p className="helper-text">主主题：{suggestion?.primaryTopic ? formatImageAssetTags([suggestion.primaryTopic]) : "无"}</p>
      <p className="helper-text">主题建议：{formatWeightedTagsDetailed(suggestion?.topicTags)}</p>
      <p className="helper-text">主情绪：{suggestion?.primaryEmotion ? formatImageAssetTags([suggestion.primaryEmotion]) : "无"}</p>
      <p className="helper-text">情绪建议：{formatEmotionTagsDetailed(suggestion?.emotionTags)}</p>
      <p className="helper-text">场景建议：{formatWeightedTagsDetailed(suggestion?.sceneTags)}</p>
      <p className="helper-text">风格建议：{formatWeightedTagsDetailed(suggestion?.styleTags)}</p>
      <p className="helper-text">风险建议：{suggestion ? formatRiskLevel(suggestion.riskLevel) : "无"}</p>
      <p className="helper-text">风险备注：{suggestion?.riskNotes || "无"}</p>
    </div>
  );
}

function formatAssetType(value: string) {
  const map: Record<string, string> = {
    meme: "表情包",
    illustration: "场景图",
    cover: "封面图",
    screenshot: "截图",
    other: "其他"
  };
  return map[value] ?? value;
}

function formatPlatformScope(value: string) {
  const map: Record<string, string> = {
    zhihu: "知乎",
    x: "X",
    both: "通用",
    unknown: "未标注"
  };
  return map[value] ?? value;
}

function formatUsageScope(value: string) {
  const map: Record<string, string> = {
    zhihu_answer: "知乎回答",
    x_post: "X 帖文",
    cover: "封面",
    reaction: "互动回复",
    general: "通用"
  };
  return map[value] ?? value;
}

function formatRiskLevel(value: string) {
  const map: Record<string, string> = {
    low: "低",
    medium: "中",
    high: "高",
    unknown: "未标注"
  };
  return map[value] ?? value;
}
