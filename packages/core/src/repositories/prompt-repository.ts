import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type {
  PromptSetName,
  PromptSnapshotMap,
  PromptTestRunSummary,
  PromptVersionSnapshot,
  PromptVersionSummary
} from "@zhihu-mvp/shared";

type PromptSetRow = RowDataPacket & {
  id: number;
  name: PromptSetName;
  title: string;
};

type PromptVersionRow = RowDataPacket & {
  id: number;
  prompt_set_id: number;
  version: number;
  label: string;
  content: string;
  notes: string | null;
  status: "draft" | "active" | "archived";
  created_at: Date;
  updated_at: Date;
  set_name?: PromptSetName;
};

type PromptTestRunRow = RowDataPacket & {
  id: number;
  prompt_version_id: number;
  input_json: string;
  output_json: string | null;
  error_text: string | null;
  created_at: Date;
};

export class PromptRepository {
  constructor(private readonly pool: Pool) {}

  async ensurePromptSets(promptSets: Array<{ name: PromptSetName; title: string }>) {
    for (const promptSet of promptSets) {
      await this.pool.query(`INSERT IGNORE INTO prompt_sets (name, title) VALUES (?, ?)`, [
        promptSet.name,
        promptSet.title
      ]);
    }
  }

  async listPromptSets() {
    const [rows] = await this.pool.query<PromptSetRow[]>(`SELECT * FROM prompt_sets ORDER BY name`);
    return rows.map((row) => ({ id: row.id, name: row.name, title: row.title }));
  }

  async getPromptSetByName(name: PromptSetName) {
    const [rows] = await this.pool.query<PromptSetRow[]>(`SELECT * FROM prompt_sets WHERE name = ? LIMIT 1`, [name]);
    const row = rows[0];
    return row ? { id: row.id, name: row.name, title: row.title } : null;
  }

  async listPromptVersions(name: PromptSetName): Promise<PromptVersionSummary[]> {
    const [rows] = await this.pool.query<PromptVersionRow[]>(
      `SELECT pv.*, ps.name AS set_name
       FROM prompt_versions pv
       JOIN prompt_sets ps ON ps.id = pv.prompt_set_id
       WHERE ps.name = ?
       ORDER BY pv.version DESC`,
      [name]
    );

    return rows.map((row) => mapPromptVersionRow(row));
  }

  async createPromptDraft(name: PromptSetName, label: string, content: string, notes: string) {
    const promptSet = await this.getPromptSetByName(name);
    if (!promptSet) {
      throw new Error(`Unknown prompt set: ${name}`);
    }

    const [versionRows] = await this.pool.query<RowDataPacket[]>(
      `SELECT COALESCE(MAX(version), 0) AS maxVersion FROM prompt_versions WHERE prompt_set_id = ?`,
      [promptSet.id]
    );
    const nextVersion = Number(versionRows[0]?.maxVersion ?? 0) + 1;
    const [result] = await this.pool.query<ResultSetHeader>(
      `INSERT INTO prompt_versions (prompt_set_id, version, label, content, notes, status)
       VALUES (?, ?, ?, ?, ?, 'draft')`,
      [promptSet.id, nextVersion, label, content, notes]
    );

    return result.insertId;
  }

  async updatePromptDraft(id: number, input: { label?: string; content?: string; notes?: string }) {
    const promptVersion = await this.getPromptVersionById(id);
    if (!promptVersion) {
      throw new Error(`Unknown prompt version: ${id}`);
    }
    if (promptVersion.status !== "draft") {
      throw new Error("Only draft prompt versions can be edited.");
    }

    await this.pool.query(
      `UPDATE prompt_versions
       SET label = COALESCE(?, label),
           content = COALESCE(?, content),
           notes = COALESCE(?, notes)
       WHERE id = ?`,
      [input.label ?? null, input.content ?? null, input.notes ?? null, id]
    );
  }

  async getPromptVersionById(id: number) {
    const [rows] = await this.pool.query<PromptVersionRow[]>(
      `SELECT pv.*, ps.name AS set_name
       FROM prompt_versions pv
       JOIN prompt_sets ps ON ps.id = pv.prompt_set_id
       WHERE pv.id = ?
       LIMIT 1`,
      [id]
    );

    return rows[0] ?? null;
  }

  async activatePromptVersion(id: number) {
    const promptVersion = await this.getPromptVersionById(id);
    if (!promptVersion) {
      throw new Error(`Unknown prompt version: ${id}`);
    }

    await this.pool.query(`UPDATE prompt_versions SET status = 'archived' WHERE prompt_set_id = ?`, [
      promptVersion.prompt_set_id
    ]);
    await this.pool.query(`UPDATE prompt_versions SET status = 'active' WHERE id = ?`, [id]);
    await this.pool.query(`INSERT INTO prompt_activations (prompt_set_id, prompt_version_id) VALUES (?, ?)`, [
      promptVersion.prompt_set_id,
      id
    ]);
  }

  async getActivePromptContent(name: PromptSetName) {
    const row = await this.getActivePromptVersion(name);
    return row?.content ?? null;
  }

  async getActivePromptVersionId(name: PromptSetName) {
    const row = await this.getActivePromptVersion(name);
    return row?.id ?? null;
  }

  async getActivePromptSnapshot(name: PromptSetName): Promise<PromptVersionSnapshot | null> {
    const row = await this.getActivePromptVersion(name);
    return row ? mapPromptSnapshot(row) : null;
  }

  async getActivePromptSnapshots(names: PromptSetName[]): Promise<PromptSnapshotMap> {
    const snapshots = await Promise.all(
      names.map(async (name) => {
        const snapshot = await this.getActivePromptSnapshot(name);
        return [name, snapshot] as const;
      })
    );

    return snapshots.reduce<PromptSnapshotMap>((accumulator, [name, snapshot]) => {
      if (snapshot) {
        accumulator[name] = snapshot;
      }
      return accumulator;
    }, {});
  }

  async recordPromptTestRun(promptVersionId: number, inputJson: string, outputJson: string | null, errorText: string | null) {
    const [result] = await this.pool.query<ResultSetHeader>(
      `INSERT INTO prompt_test_runs (prompt_version_id, input_json, output_json, error_text)
       VALUES (?, ?, ?, ?)`,
      [promptVersionId, inputJson, outputJson, errorText]
    );
    return result.insertId;
  }

  async listPromptTestRuns(name: PromptSetName): Promise<PromptTestRunSummary[]> {
    const [rows] = await this.pool.query<PromptTestRunRow[]>(
      `SELECT ptr.*
       FROM prompt_test_runs ptr
       JOIN prompt_versions pv ON pv.id = ptr.prompt_version_id
       JOIN prompt_sets ps ON ps.id = pv.prompt_set_id
       WHERE ps.name = ?
       ORDER BY ptr.created_at DESC
       LIMIT 20`,
      [name]
    );

    return rows.map((row) => ({
      id: row.id,
      promptVersionId: row.prompt_version_id,
      createdAt: row.created_at.toISOString(),
      inputJson: row.input_json,
      outputJson: row.output_json,
      errorText: row.error_text
    }));
  }

  private async getActivePromptVersion(name: PromptSetName) {
    const [rows] = await this.pool.query<PromptVersionRow[]>(
      `SELECT pv.*, ps.name AS set_name
       FROM prompt_versions pv
       JOIN prompt_sets ps ON ps.id = pv.prompt_set_id
       WHERE ps.name = ? AND pv.status = 'active'
       ORDER BY pv.version DESC
       LIMIT 1`,
      [name]
    );

    return rows[0] ?? null;
  }
}

function mapPromptVersionRow(row: PromptVersionRow): PromptVersionSummary {
  return {
    id: row.id,
    setName: row.set_name as PromptSetName,
    version: row.version,
    status: row.status,
    label: row.label,
    notes: row.notes ?? "",
    content: row.content,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapPromptSnapshot(row: PromptVersionRow): PromptVersionSnapshot {
  return {
    promptSetName: row.set_name as PromptSetName,
    promptVersionId: row.id,
    version: row.version,
    label: row.label,
    content: row.content
  };
}
