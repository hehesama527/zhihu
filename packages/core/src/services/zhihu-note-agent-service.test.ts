import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ZhihuNoteAgentGenerateInput } from "@zhihu-mvp/shared";
import { ZhihuAccountLibraryRepository } from "../repositories/zhihu-account-library-repository.js";
import { ZhihuNoteAgentService, evaluateCollectedSamples } from "./zhihu-note-agent-service.js";

test("evaluateCollectedSamples filters slogans, announcements, duplicates, repeated closings, and short answers", () => {
  const evaluated = evaluateCollectedSamples(
    [
      buildCollectedSample("保留样本", buildLongSample("第一次复盘时，我会先把日线节奏拆开。", "先把回撤看清楚，再谈仓位安排。")),
      buildCollectedSample("品牌口号", buildLongSample("很多人上来就先喊口号。", "欢迎交流，记得关注和收藏。")),
      buildCollectedSample("活动公告", buildLongSample("这周主要是活动通知和报名安排。", "课程报名和福利链接都在评论区。")),
      buildCollectedSample("近重复样本", buildLongSample("第一次复盘时，我会先把日线节奏拆开。", "先把回撤看清楚，再谈仓位安排。")),
      buildCollectedSample("重复结尾", buildLongSample("第二次复盘时，我会先看成交量和失效位。", "先把回撤看清楚，再谈仓位安排。")),
      buildCollectedSample("过短回答", "太短了。")
    ],
    {
      targetPositioning: "目标账号定位：偏交易复盘、口吻克制、少喊口号。",
      sampleFilterMarkdown: "# Sample Filter"
    }
  );

  const reasons = new Map(evaluated.map((item) => [item.sample.questionTitle, item.reasons]));

  assert.equal(evaluated.filter((item) => item.keep).length, 1);
  assert.deepEqual(reasons.get("保留样本"), []);
  assert.ok(reasons.get("品牌口号")?.includes("brand_slogan"));
  assert.ok(reasons.get("活动公告")?.includes("pure_announcement"));
  assert.ok(reasons.get("近重复样本")?.includes("near_duplicate"));
  assert.ok(reasons.get("重复结尾")?.includes("repeated_closing"));
  assert.ok(reasons.get("过短回答")?.includes("low_information"));
});

test("ZhihuNoteAgentService generateDraft returns a soul-only draft and weak sample quality does not fail", async () => {
  await withTempDataDir(async () => {
    const repository = new ZhihuAccountLibraryRepository();
    const openings = [
      "遇到单边行情时，我先拆趋势，再看失效位。",
      "真正做复盘时，我通常先看量价有没有同步。",
      "如果行情开始加速，我会先确认是不是假突破。",
      "盘中最容易出错的时候，我反而会先回看日线结构。",
      "很多人纠结入场点，我更在意条件是不是同时成立。"
    ];
    const closings = [
      "最后会把这次判断写回执行清单，避免下一次又凭感觉。",
      "收尾时我会把失效条件补上，不让结论看起来像口号。",
      "真正落地的时候，我只保留还能执行的那几条判断。",
      "如果边界不清楚，这个结论宁可不用，也不强行下定义。",
      "写完之后我会再看一遍，确认自己没有把概率说成确定性。"
    ];
    const service = new ZhihuNoteAgentService(createStubLlm(), repository, undefined, async (_sourceAccount, input) => ({
      samples: Array.from({ length: 5 }, (_, index) =>
        buildCollectedSample(
          `问题 ${index + 1}`,
          buildLongSample(
            openings[index] ?? `样本开头 ${index + 1}`,
            closings[index] ?? `样本结尾 ${index + 1}`
          )
        )
      ).slice(0, input.sampleLimit),
      diagnostics: ["stub collector"],
      collectionSucceeded: true
    }));

    const account = {
      id: 201,
      name: "知乎测试号",
      zhihuUserName: "zhihu-test"
    };
    const draft = await service.generateDraft(account, buildGenerateInput());

    assert.equal(draft.accountId, account.id);
    assert.equal(draft.sampleQuality, "weak");
    assert.ok(draft.collectionSummary.keptSampleCount >= 4);
    assert.equal(draft.phaseReports.length, 2);
    assert.ok(draft.soulCandidateMarkdown.trim().length > 0);
    assert.match(draft.sourcePaths.soulCandidatePath, /soul_candidate\.md$/);
    assert.equal("styleRulesMarkdown" in draft, false);
    assert.equal("learnedSamplesJsonl" in draft, false);
  });
});

test("ZhihuNoteAgentService generateDraft fails only when zero usable samples remain", async () => {
  await withTempDataDir(async () => {
    const repository = new ZhihuAccountLibraryRepository();
    const service = new ZhihuNoteAgentService(createStubLlm(), repository, undefined, async () => ({
      samples: [],
      diagnostics: ["empty"],
      collectionSucceeded: false
    }));

    await assert.rejects(
      () =>
        service.generateDraft(
          {
            id: 202,
            name: "空样本账号",
            zhihuUserName: "empty-user"
          },
          buildGenerateInput()
        ),
      /0 usable samples/
    );
  });
});

test("ZhihuNoteAgentService applyDraft writes only soul candidate for the current account", async () => {
  await withTempDataDir(async () => {
    const repository = new ZhihuAccountLibraryRepository();
    const service = new ZhihuNoteAgentService(createStubLlm(), repository, undefined, async (_sourceAccount, input) => ({
      samples: Array.from({ length: 8 }, (_, index) =>
        buildCollectedSample(
          `问题 ${index + 1}`,
          buildLongSample(
            `第 ${index + 1} 次回答时，我会先把判断条件讲清楚。`,
            `最后会把第 ${index + 1} 条执行边界写明白。`
          )
        )
      ).slice(0, input.sampleLimit),
      diagnostics: [],
      collectionSucceeded: true
    }));

    const account = {
      id: 203,
      name: "应用测试账号",
      zhihuUserName: "apply-user"
    };
    const draft = await service.generateDraft(account, buildGenerateInput());
    const result = await service.applyDraft(account, {
      draft,
      actions: {
        saveSoulCandidate: true
      }
    });

    assert.equal(result.actionsApplied.saveSoulCandidate, true);
    assert.equal(result.writtenPaths.length, 1);
    assert.ok(result.writtenPaths.every((item) => item.includes(`account_${account.id}`)));
    assert.match(result.writtenPaths[0] ?? "", /soul_candidate\.md$/);

    for (const filePath of result.writtenPaths) {
      const content = await fs.readFile(filePath, "utf8");
      assert.ok(content.trim().length > 0);
    }

    const styleRulesPath = repository.getAccountLibraryDocumentPath(`account_${account.id}`, "style_rules.md");
    await assert.rejects(() => fs.readFile(styleRulesPath, "utf8"));

    const validationByLabel = new Map(result.phaseReport.validationChecks.map((check) => [check.label, check]));
    assert.equal(validationByLabel.get("soul_candidate_non_empty")?.passed, true);
    assert.equal(result.phaseReport.phase, "apply_soul_candidate");
  });
});

test("ZhihuNoteAgentService applyDraft rejects mismatched drafts and empty documents", async () => {
  await withTempDataDir(async () => {
    const repository = new ZhihuAccountLibraryRepository();
    const service = new ZhihuNoteAgentService(createStubLlm(), repository, undefined, async (_sourceAccount, input) => ({
      samples: Array.from({ length: 4 }, (_, index) =>
        buildCollectedSample(
          `问题 ${index + 1}`,
          buildLongSample(
            `第 ${index + 1} 条样本会先给结论，再解释判断过程。`,
            `最后会写清楚第 ${index + 1} 个边界条件。`
          )
        )
      ).slice(0, input.sampleLimit),
      diagnostics: [],
      collectionSucceeded: true
    }));

    const account = {
      id: 204,
      name: "校验账号",
      zhihuUserName: "validate-user"
    };
    const draft = await service.generateDraft(account, buildGenerateInput());

    await assert.rejects(
      () =>
        service.applyDraft(account, {
          draft: {
            ...draft,
            accountId: 999
          }
        }),
      /accountId does not match/
    );

    await assert.rejects(
      () =>
        service.applyDraft(account, {
          draft: {
            ...draft,
            soulCandidateMarkdown: ""
          }
        }),
      /markdown content cannot be empty/
    );
  });
});

function buildGenerateInput(): ZhihuNoteAgentGenerateInput {
  return {
    mode: "zhihu_answer_style_learning",
    sourceAccount: {
      platform: "zhihu",
      handleOrUrl: "https://www.zhihu.com/people/source-user"
    },
    sampleLimit: 35,
    filterConfigVersion: "v1"
  };
}

function createStubLlm() {
  return {
    async runJson<T>(_promptSetName: string, _input: unknown, fallback: T): Promise<T> {
      return fallback;
    }
  };
}

function buildCollectedSample(questionTitle: string, text: string) {
  return {
    answerUrl: `https://www.zhihu.com/question/${encodeURIComponent(questionTitle)}/answer/1`,
    questionTitle,
    questionUrl: `https://www.zhihu.com/question/${encodeURIComponent(questionTitle)}`,
    createdAt: "2026-04-23T00:00:00.000Z",
    excerpt: text.slice(0, 90),
    text
  };
}

function buildLongSample(opening: string, ending: string) {
  return [
    opening,
    "通常我不会直接给一个绝对结论，而是先把趋势、量能、回撤和失效位放到同一张复盘表里看。",
    "这样做的好处是，你能知道这次判断到底依赖了哪些条件，而不是只记住一个模糊感觉。",
    "如果几个条件彼此打架，我会先降预期，再看是不是值得继续跟踪。",
    ending
  ].join("");
}

async function withTempDataDir(run: () => Promise<void>) {
  const previousDataDir = process.env.DATA_DIR;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhihu-note-agent-test-"));
  process.env.DATA_DIR = tempDir;

  try {
    await run();
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = previousDataDir;
    }

    await fs.rm(tempDir, {
      recursive: true,
      force: true
    });
  }
}
