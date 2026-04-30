import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ZhihuAccountLibraryRepository } from "./zhihu-account-library-repository.js";

test("ZhihuAccountLibraryRepository bootstraps account library assets", async () => {
  await withTempDataDir(async () => {
    const repository = new ZhihuAccountLibraryRepository();
    const account = {
      id: 101,
      name: "测试账户",
      zhihuUserName: "test-user"
    };

    const resolved = await repository.ensureAccountLibraryForAccount(account);

    assert.equal(resolved.accountKey, "account_101");
    assert.equal(resolved.matchedBy, "bootstrapped");

    const map = await repository.readAccountMap();
    assert.equal(map.mappings.length, 1);
    assert.equal(map.mappings[0]?.accountKey, "account_101");

    const styleRulesPath = repository.getAccountLibraryDocumentPath(resolved.accountKey, "style_rules.md");
    const soulCandidatePath = repository.getAccountNoteAgentAssetPath(resolved.accountKey, "soul_candidate.md");
    assert.match(await fs.readFile(styleRulesPath, "utf8"), /Style Rules/);
    assert.equal(await fs.readFile(soulCandidatePath, "utf8"), "");
  });
});

test("ZhihuAccountLibraryRepository can prepare soul-only note-agent storage without RAG docs", async () => {
  await withTempDataDir(async () => {
    const repository = new ZhihuAccountLibraryRepository();
    const account = {
      id: 102,
      name: "Soul Only",
      zhihuUserName: "soul-only"
    };

    const resolved = await repository.ensureAccountNoteAgentStorageForAccount(account);

    assert.equal(resolved.accountKey, "account_102");
    assert.equal(resolved.matchedBy, "bootstrapped");
    await fs.access(repository.getAccountNoteAgentDirPath(resolved.accountKey));
    await assert.rejects(() => fs.readFile(repository.getAccountLibraryDocumentPath(resolved.accountKey, "style_rules.md"), "utf8"));
  });
});

test("ZhihuAccountLibraryRepository resolves mappings by accountId before username and account name", async () => {
  await withTempDataDir(async () => {
    const repository = new ZhihuAccountLibraryRepository();
    await repository.ensureReady();
    await fs.writeFile(
      repository.getAccountMapPath(),
      JSON.stringify(
        {
          version: 1,
          mappings: [
            {
              accountKey: "by-user",
              enabled: true,
              accountIds: [],
              zhihuUserNames: ["target-user"],
              accountNames: []
            },
            {
              accountKey: "by-name",
              enabled: true,
              accountIds: [],
              zhihuUserNames: [],
              accountNames: ["目标账号"]
            },
            {
              accountKey: "by-id",
              enabled: true,
              accountIds: [7],
              zhihuUserNames: ["target-user"],
              accountNames: ["目标账号"]
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const byId = await repository.resolveAccountLibrary({
      id: 7,
      name: "目标账号",
      zhihuUserName: "target-user"
    });
    const byUserName = await repository.resolveAccountLibrary({
      id: 8,
      name: "其他账号",
      zhihuUserName: "target-user"
    });
    const byAccountName = await repository.resolveAccountLibrary({
      id: 9,
      name: "目标账号",
      zhihuUserName: "other-user"
    });

    assert.deepEqual(byId, {
      accountKey: "by-id",
      matchedBy: "accountId"
    });
    assert.deepEqual(byUserName, {
      accountKey: "by-user",
      matchedBy: "zhihuUserName"
    });
    assert.deepEqual(byAccountName, {
      accountKey: "by-name",
      matchedBy: "accountName"
    });
  });
});

test("ZhihuAccountLibraryRepository rejects path traversal for library docs and note-agent assets", async () => {
  await withTempDataDir(async () => {
    const repository = new ZhihuAccountLibraryRepository();

    assert.throws(
      () => repository.getAccountLibraryDocumentPath("account_1", "..\\evil.txt"),
      /Invalid Zhihu account library path/
    );
    assert.throws(
      () => repository.getAccountNoteAgentAssetPath("account_1", "..\\evil.txt"),
      /Invalid Zhihu note-agent asset path/
    );
  });
});

async function withTempDataDir(run: () => Promise<void>) {
  const previousDataDir = process.env.DATA_DIR;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhihu-library-test-"));
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
