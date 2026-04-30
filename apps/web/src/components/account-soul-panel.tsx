"use client";

import type { AccountSoulDocument, AccountStatusView } from "@zhihu-mvp/shared";
import { useEffect, useMemo, useState, useTransition } from "react";
import { fetchClientResponse } from "../lib/http";

type AccountSoulPanelProps = {
  account: AccountStatusView;
};

type SoulFormState = {
  coreIdentity: string;
  targetReader: string;
  voiceTraitsText: string;
  worldviewText: string;
  proofAnchorsText: string;
  signatureMovesText: string;
  productMentionPolicyText: string;
  hardBoundariesText: string;
  tabooLexiconText: string;
  exemplarLinesText: string;
  updateReason: string;
};

const DEFAULT_SOUL_FORM: SoulFormState = {
  coreIdentity: "",
  targetReader: "",
  voiceTraitsText: "",
  worldviewText: "",
  proofAnchorsText: "",
  signatureMovesText: "",
  productMentionPolicyText: "",
  hardBoundariesText: "",
  tabooLexiconText: "",
  exemplarLinesText: "",
  updateReason: "manual_edit"
};

export function AccountSoulPanel({ account }: AccountSoulPanelProps) {
  const [soulDocument, setSoulDocument] = useState<AccountSoulDocument | null>(null);
  const [soulForm, setSoulForm] = useState<SoulFormState>(DEFAULT_SOUL_FORM);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage("");

    void request<{ soulDocument: AccountSoulDocument }>(`/accounts/${account.id}/soul`, undefined, "GET")
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setSoulDocument(payload.soulDocument);
        setSoulForm(buildSoulForm(payload.soulDocument));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setSoulDocument(null);
        setSoulForm(DEFAULT_SOUL_FORM);
        setMessage(error instanceof Error ? error.message : "加载 Soul 失败");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [account.id]);

  const soulPreviewMarkdown = useMemo(() => buildSoulPreviewMarkdown(account.id, soulForm), [account.id, soulForm]);

  function updateSoulForm<K extends keyof SoulFormState>(key: K, value: SoulFormState[K]) {
    setSoulForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  function saveSoul() {
    setMessage("");
    startTransition(async () => {
      try {
        const payload = await request<{ ok: boolean; soulDocument: AccountSoulDocument }>(`/accounts/${account.id}/soul`, {
          coreIdentity: soulForm.coreIdentity,
          targetReader: soulForm.targetReader,
          voiceTraits: splitLineList(soulForm.voiceTraitsText),
          worldview: splitLineList(soulForm.worldviewText),
          proofAnchors: splitLineList(soulForm.proofAnchorsText),
          signatureMoves: splitLineList(soulForm.signatureMovesText),
          productMentionPolicy: splitLineList(soulForm.productMentionPolicyText),
          hardBoundaries: splitLineList(soulForm.hardBoundariesText),
          tabooLexicon: splitLineList(soulForm.tabooLexiconText),
          exemplarLines: splitLineList(soulForm.exemplarLinesText),
          updateReason: soulForm.updateReason.trim() || "manual_edit"
        }, "PUT");

        setSoulDocument(payload.soulDocument);
        setSoulForm(buildSoulForm(payload.soulDocument));
        setMessage("Soul 已保存。后续新建任务会固化当前 Soul 快照，writer 和 review 都会按这版人设执行。");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "保存 Soul 失败");
      }
    });
  }

  return (
    <div className="card">
      <div className="stack stack--tight">
        <h3>账号 Soul</h3>
        <p className="helper-text">
          Soul 是账号级的人设、口吻和边界文档。知乎 writer 会按这份 Soul 写，review 也会按这份 Soul 检查“像不像这个号会写出来的话”。
        </p>
        <p className="helper-text">
          {loading
            ? "正在加载 Soul..."
            : soulDocument
              ? `当前版本：v${soulDocument.version} | 更新时间：${formatTime(soulDocument.lastUpdatedAt)} | 更新人：${soulDocument.updatedBy}`
              : "当前还没有 Soul 文档，系统会先按账号基础信息生成一版初始文档。"}
        </p>
      </div>

      <div className="grid grid--two" style={{ marginTop: "1rem" }}>
        <label className="field">
          <span>核心身份</span>
          <textarea rows={4} value={soulForm.coreIdentity} onChange={(event) => updateSoulForm("coreIdentity", event.target.value)} placeholder="这个账号到底是谁，用什么视角说话。" />
        </label>

        <label className="field">
          <span>目标读者</span>
          <textarea rows={4} value={soulForm.targetReader} onChange={(event) => updateSoulForm("targetReader", event.target.value)} placeholder="写给谁看，他们通常在什么处境里点开这类回答。" />
        </label>

        <label className="field">
          <span>声音特征</span>
          <textarea rows={6} value={soulForm.voiceTraitsText} onChange={(event) => updateSoulForm("voiceTraitsText", event.target.value)} placeholder="每行一条，例如：先给判断，再补理由" />
        </label>

        <label className="field">
          <span>价值观 / 观察方式</span>
          <textarea rows={6} value={soulForm.worldviewText} onChange={(event) => updateSoulForm("worldviewText", event.target.value)} placeholder="每行一条，例如：只写自己能承担的判断" />
        </label>

        <label className="field">
          <span>可信锚点</span>
          <textarea rows={6} value={soulForm.proofAnchorsText} onChange={(event) => updateSoulForm("proofAnchorsText", event.target.value)} placeholder="每行一条，说明这个账号为什么有资格这样说。" />
        </label>

        <label className="field">
          <span>惯用动作</span>
          <textarea rows={6} value={soulForm.signatureMovesText} onChange={(event) => updateSoulForm("signatureMovesText", event.target.value)} placeholder="每行一条，例如：先拆误区，再给自己的做法" />
        </label>

        <label className="field">
          <span>产品提及规则</span>
          <textarea rows={6} value={soulForm.productMentionPolicyText} onChange={(event) => updateSoulForm("productMentionPolicyText", event.target.value)} placeholder="每行一条，约束什么时候能提产品、怎么提才自然。" />
        </label>

        <label className="field">
          <span>硬边界</span>
          <textarea rows={6} value={soulForm.hardBoundariesText} onChange={(event) => updateSoulForm("hardBoundariesText", event.target.value)} placeholder="每行一条，明确这个账号绝对不会说什么。" />
        </label>

        <label className="field">
          <span>禁忌词 / 禁忌表达</span>
          <textarea rows={6} value={soulForm.tabooLexiconText} onChange={(event) => updateSoulForm("tabooLexiconText", event.target.value)} placeholder="每行一条，列出不该出现的词、句式或腔调。" />
        </label>

        <label className="field">
          <span>示例句</span>
          <textarea rows={6} value={soulForm.exemplarLinesText} onChange={(event) => updateSoulForm("exemplarLinesText", event.target.value)} placeholder="每行一条，只给风格参考，不会原样照搬。" />
        </label>
      </div>

      <label className="field" style={{ marginTop: "1rem" }}>
        <span>更新原因</span>
        <input value={soulForm.updateReason} onChange={(event) => updateSoulForm("updateReason", event.target.value)} placeholder="例如：manual_edit / persona_refine" />
      </label>

      <div className="button-row" style={{ marginTop: "1rem" }}>
        <button className="button" disabled={pending || loading} onClick={saveSoul}>
          {pending ? "处理中..." : "保存 Soul"}
        </button>
      </div>

      <div className="stack stack--tight" style={{ marginTop: "1rem" }}>
        <p className="helper-text">预览的是会注入到 writer / review 的 Soul markdown。</p>
        <textarea rows={22} readOnly value={soulPreviewMarkdown} />
      </div>

      {message ? <p className="helper-text" style={{ marginTop: "0.8rem" }}>{message}</p> : null}
    </div>
  );
}

async function request<T>(path: string, body?: unknown, method = "POST") {
  const { response, text, payload } = await fetchClientResponse(path, {
    method,
    headers: {
      "content-type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    const errorMessage =
      typeof payload.error === "object" && payload.error && "message" in payload.error
        ? String((payload.error as { message?: unknown }).message ?? "")
        : text;
    throw new Error(errorMessage || "请求失败。");
  }

  return payload as T;
}

function buildSoulForm(document: AccountSoulDocument | null): SoulFormState {
  if (!document) {
    return DEFAULT_SOUL_FORM;
  }

  return {
    coreIdentity: document.coreIdentity,
    targetReader: document.targetReader,
    voiceTraitsText: joinLineList(document.voiceTraits),
    worldviewText: joinLineList(document.worldview),
    proofAnchorsText: joinLineList(document.proofAnchors),
    signatureMovesText: joinLineList(document.signatureMoves),
    productMentionPolicyText: joinLineList(document.productMentionPolicy),
    hardBoundariesText: joinLineList(document.hardBoundaries),
    tabooLexiconText: joinLineList(document.tabooLexicon),
    exemplarLinesText: joinLineList(document.exemplarLines),
    updateReason: document.updateReason || "manual_edit"
  };
}

function buildSoulPreviewMarkdown(accountId: number, form: SoulFormState) {
  return [
    "# Account Soul",
    "",
    `- Account ID: ${accountId}`,
    "- Version: draft",
    `- Update Reason: ${form.updateReason.trim() || "manual_edit"}`,
    "",
    renderSoulTextSection("Core Identity", form.coreIdentity),
    renderSoulTextSection("Target Reader", form.targetReader),
    renderSoulListSection("Voice Traits", splitLineList(form.voiceTraitsText)),
    renderSoulListSection("Worldview", splitLineList(form.worldviewText)),
    renderSoulListSection("Proof Anchors", splitLineList(form.proofAnchorsText)),
    renderSoulListSection("Signature Moves", splitLineList(form.signatureMovesText)),
    renderSoulListSection("Product Mention Policy", splitLineList(form.productMentionPolicyText)),
    renderSoulListSection("Hard Boundaries", splitLineList(form.hardBoundariesText)),
    renderSoulListSection("Taboo Lexicon", splitLineList(form.tabooLexiconText)),
    renderSoulListSection("Exemplar Lines", splitLineList(form.exemplarLinesText))
  ].join("\n");
}

function renderSoulTextSection(title: string, value: string) {
  return [`## ${title}`, "", value.trim() || "Not set.", ""].join("\n");
}

function renderSoulListSection(title: string, values: string[]) {
  return [`## ${title}`, "", ...(values.length ? values.map((item) => `- ${item}`) : ["- Not set."]), ""].join("\n");
}

function splitLineList(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLineList(values: string[]) {
  return values.join("\n");
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无";
}
