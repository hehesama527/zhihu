import type { DraftListItem, TopicListItem, TopicPriority, TopicValidityStatus } from "@zhihu-mvp/shared";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

type TopicCandidateRow = RowDataPacket & {
  id: number;
  question_url: string;
  question_title: string;
  source_type: string;
  source_metadata_text: string | null;
  priority: TopicPriority | null;
  fit_score: number | null;
  question_type: string | null;
  persona_mode: string | null;
  must_avoid_text: string | null;
  risk_notes_text: string | null;
  validity_status: TopicValidityStatus;
  validity_reason: string | null;
  status: string;
  duplication_fingerprint_text: string | null;
  created_at: Date;
  topic_summary?: string | null;
};

type TopicCardRow = RowDataPacket & {
  id: number;
  topic_candidate_id: number;
  summary_text: string;
  output_json: string;
  created_at: Date;
};

type DraftRow = RowDataPacket & {
  id: number;
  topic_card_id: number;
  draft_type: string;
  content: string;
  summary_text: string | null;
  output_json: string;
  created_at: Date;
};

type ReviewRow = RowDataPacket & {
  id: number;
  draft_id: number;
  review_status: string;
  hard_gate_json: string;
  editorial_review_json: string;
  publish_review_json: string;
  topic_duplication_json: string;
  content_duplication_json: string;
  approved_content: string | null;
  review_summary: string | null;
  created_at: Date;
};

type DraftListRow = RowDataPacket & {
  id: number;
  topic_card_id: number;
  topic_candidate_id: number;
  question_title: string;
  question_url: string;
  raw_draft_content: string | null;
  humanized_content: string | null;
  approved_content: string | null;
  review_status: string | null;
  review_summary: string | null;
  created_at: Date;
};

export class TopicRepository {
  constructor(private readonly pool: Pool) {}

  async createOrGetCandidate(input: {
    questionUrl: string;
    questionTitle: string;
    sourceType: string;
    sourceMetadata: unknown;
  }) {
    const [existing] = await this.pool.query<TopicCandidateRow[]>(
      `SELECT * FROM topic_candidates WHERE question_url = ? LIMIT 1`,
      [input.questionUrl]
    );
    if (existing[0]) {
      const mergedMetadata = mergeSourceMetadata(existing[0].source_metadata_text, input.sourceType, input.sourceMetadata);
      await this.pool.query(
        `UPDATE topic_candidates
         SET source_type = ?,
             source_metadata_text = ?
         WHERE id = ?`,
        [input.sourceType, JSON.stringify(mergedMetadata), existing[0].id]
      );
      return {
        id: existing[0].id,
        isNew: false
      };
    }

    const [result] = await this.pool.query<ResultSetHeader>(
      `INSERT INTO topic_candidates (question_url, question_title, source_type, source_metadata_text)
       VALUES (?, ?, ?, ?)`,
      [
        input.questionUrl,
        input.questionTitle,
        input.sourceType,
        JSON.stringify(mergeSourceMetadata(null, input.sourceType, input.sourceMetadata))
      ]
    );
    return {
      id: result.insertId,
      isNew: true
    };
  }

  async listOpenCandidates(limit = 20) {
    const [rows] = await this.pool.query<TopicCandidateRow[]>(
      `SELECT *
       FROM topic_candidates
       WHERE status IN ('new', 'processing')
         AND validity_status IN ('unchecked', 'valid')
       ORDER BY
         CASE priority
           WHEN 'P0' THEN 1
           WHEN 'P1' THEN 2
           WHEN 'P2' THEN 3
           WHEN 'SKIP' THEN 9
           ELSE 4
         END ASC,
         COALESCE(fit_score, 0) DESC,
         created_at ASC
       LIMIT ?`,
      [limit]
    );

    return rows.map((row) => ({
      id: row.id,
      questionUrl: row.question_url,
      questionTitle: row.question_title,
      sourceType: row.source_type,
      sourceMetadataText: row.source_metadata_text,
      priority: row.priority,
      fitScore: row.fit_score,
      questionType: row.question_type,
      personaMode: row.persona_mode,
      mustAvoid: safeParseStringArray(row.must_avoid_text),
      riskNotes: safeParseStringArray(row.risk_notes_text),
      validityStatus: row.validity_status,
      validityReason: row.validity_reason,
      status: row.status,
      duplicationFingerprintText: row.duplication_fingerprint_text,
      createdAt: row.created_at.toISOString()
    }));
  }

  async listTopics(limit = 100): Promise<TopicListItem[]> {
    const [rows] = await this.pool.query<TopicCandidateRow[]>(
      `SELECT tc.*, tcard.summary_text AS topic_summary
       FROM topic_candidates tc
       LEFT JOIN topic_cards tcard ON tcard.id = (
         SELECT t2.id
         FROM topic_cards t2
         WHERE t2.topic_candidate_id = tc.id
         ORDER BY t2.id DESC
         LIMIT 1
       )
       ORDER BY tc.created_at DESC
       LIMIT ?`,
      [limit]
    );

    return rows.map((row) => ({
      id: row.id,
      questionTitle: row.question_title,
      questionUrl: row.question_url,
      sourceType: row.source_type,
      status: row.status,
      priority: row.priority,
      fitScore: row.fit_score,
      questionType: row.question_type,
      personaMode: row.persona_mode,
      mustAvoid: safeParseStringArray(row.must_avoid_text),
      riskNotes: safeParseStringArray(row.risk_notes_text),
      validityStatus: row.validity_status,
      validityReason: row.validity_reason,
      topicSummary: row.topic_summary ?? null,
      createdAt: row.created_at.toISOString()
    }));
  }

  async listDrafts(limit = 100): Promise<DraftListItem[]> {
    const [rows] = await this.pool.query<DraftListRow[]>(
      `SELECT
         rv.id,
         tcard.id AS topic_card_id,
         tc.id AS topic_candidate_id,
         tc.question_title,
         tc.question_url,
         draft_raw.content AS raw_draft_content,
         draft_humanized.content AS humanized_content,
         rv.approved_content,
         rv.review_status,
         rv.review_summary,
         rv.created_at
       FROM reviews rv
       JOIN drafts draft_humanized ON draft_humanized.id = rv.draft_id
       JOIN topic_cards tcard ON tcard.id = draft_humanized.topic_card_id
       JOIN topic_candidates tc ON tc.id = tcard.topic_candidate_id
       LEFT JOIN drafts draft_raw ON draft_raw.id = (
         SELECT dr.id
         FROM drafts dr
         WHERE dr.topic_card_id = tcard.id AND dr.draft_type = 'raw'
         ORDER BY dr.id DESC
         LIMIT 1
       )
       ORDER BY rv.created_at DESC, rv.id DESC
       LIMIT ?`,
      [limit]
    );

    return rows.map((row) => ({
      id: row.id,
      topicCardId: row.topic_card_id,
      topicCandidateId: row.topic_candidate_id,
      questionTitle: row.question_title,
      questionUrl: row.question_url,
      rawDraftContent: row.raw_draft_content,
      humanizedContent: row.humanized_content,
      approvedContent: row.approved_content,
      reviewStatus: row.review_status,
      reviewSummary: row.review_summary,
      canPublish: row.review_status === "pass",
      createdAt: row.created_at.toISOString()
    }));
  }

  async countOpenCandidates() {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count
       FROM topic_candidates
       WHERE status IN ('new', 'processing')
         AND validity_status IN ('unchecked', 'valid')`
    );
    return Number(rows[0]?.count ?? 0);
  }

  async countActiveCandidates() {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count
       FROM topic_candidates
       WHERE status IN ('new', 'processing', 'accepted')
         AND validity_status IN ('unchecked', 'valid')`
    );
    return Number(rows[0]?.count ?? 0);
  }

  async reconcileAcceptedCandidateStatuses() {
    await this.pool.query(
      `UPDATE topic_candidates tc
       JOIN topic_cards tcard ON tcard.topic_candidate_id = tc.id
       JOIN publish_jobs pj ON pj.topic_card_id = tcard.id
       SET tc.status = CASE
         WHEN pj.status = 'published' THEN 'published'
         WHEN pj.status = 'failed_terminal' THEN 'publish_failed'
         ELSE tc.status
       END
       WHERE tc.status = 'accepted'
         AND pj.status IN ('published', 'failed_terminal')`
    );
  }

  async markCandidateProcessing(candidateId: number, fingerprint?: string | null) {
    await this.pool.query(
      `UPDATE topic_candidates
       SET status = 'processing',
           duplication_fingerprint_text = COALESCE(?, duplication_fingerprint_text)
       WHERE id = ?`,
      [fingerprint ?? null, candidateId]
    );
  }

  async markCandidateAccepted(candidateId: number, fingerprint?: string | null) {
    await this.pool.query(
      `UPDATE topic_candidates
       SET status = 'accepted',
           duplication_fingerprint_text = COALESCE(?, duplication_fingerprint_text)
       WHERE id = ?`,
      [fingerprint ?? null, candidateId]
    );
  }

  async markCandidateDuplicate(candidateId: number, reason: string) {
    await this.pool.query(
      `UPDATE topic_candidates
       SET status = 'blocked_duplicate',
           duplication_fingerprint_text = ?
       WHERE id = ?`,
      [reason, candidateId]
    );
  }

  async markCandidateBlocked(candidateId: number, reason: string) {
    await this.pool.query(
      `UPDATE topic_candidates
       SET status = 'blocked',
           duplication_fingerprint_text = ?
       WHERE id = ?`,
      [reason, candidateId]
    );
  }

  async markCandidateDuplicateByTopicCard(topicCardId: number, reason: string) {
    await this.pool.query(
      `UPDATE topic_candidates tc
       JOIN topic_cards tcard ON tcard.topic_candidate_id = tc.id
       SET tc.status = 'blocked_duplicate',
           tc.duplication_fingerprint_text = ?
       WHERE tcard.id = ?`,
      [reason, topicCardId]
    );
  }

  async markCandidatePublishedByTopicCard(topicCardId: number) {
    await this.pool.query(
      `UPDATE topic_candidates tc
       JOIN topic_cards tcard ON tcard.topic_candidate_id = tc.id
       SET tc.status = 'published'
       WHERE tcard.id = ?`,
      [topicCardId]
    );
  }

  async markCandidatePublishFailedByTopicCard(topicCardId: number, reason?: string | null) {
    await this.pool.query(
      `UPDATE topic_candidates tc
       JOIN topic_cards tcard ON tcard.topic_candidate_id = tc.id
       SET tc.status = 'publish_failed',
           tc.duplication_fingerprint_text = COALESCE(?, tc.duplication_fingerprint_text)
       WHERE tcard.id = ?`,
      [reason ?? null, topicCardId]
    );
  }

  async updateCandidateTopicMeta(input: {
    candidateId: number;
    priority?: TopicPriority | null;
    fitScore?: number | null;
    questionType?: string | null;
    personaMode?: string | null;
    mustAvoid?: string[];
    riskNotes?: string[];
  }) {
    await this.pool.query(
      `UPDATE topic_candidates
       SET priority = COALESCE(?, priority),
           fit_score = COALESCE(?, fit_score),
           question_type = COALESCE(?, question_type),
           persona_mode = COALESCE(?, persona_mode),
           must_avoid_text = COALESCE(?, must_avoid_text),
           risk_notes_text = COALESCE(?, risk_notes_text)
       WHERE id = ?`,
      [
        input.priority ?? null,
        input.fitScore ?? null,
        input.questionType ?? null,
        input.personaMode ?? null,
        input.mustAvoid ? JSON.stringify(input.mustAvoid) : null,
        input.riskNotes ? JSON.stringify(input.riskNotes) : null,
        input.candidateId
      ]
    );
  }

  async cacheCandidatePrefilter(candidateId: number, prefilterOutput: unknown) {
    const [rows] = await this.pool.query<TopicCandidateRow[]>(
      `SELECT source_metadata_text
       FROM topic_candidates
       WHERE id = ?
       LIMIT 1`,
      [candidateId]
    );

    const currentMetadata = safeParseRecord(rows[0]?.source_metadata_text ?? null);
    const mergedMetadata = {
      ...currentMetadata,
      prefilterTopicCard: prefilterOutput,
      prefilterCachedAt: new Date().toISOString()
    };

    await this.pool.query(
      `UPDATE topic_candidates
       SET source_metadata_text = ?
       WHERE id = ?`,
      [JSON.stringify(mergedMetadata), candidateId]
    );
  }

  async markCandidateValidity(candidateId: number, validityStatus: TopicValidityStatus, validityReason: string | null) {
    await this.pool.query(
      `UPDATE topic_candidates
       SET validity_status = ?,
           validity_reason = ?,
           checked_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [validityStatus, validityReason, candidateId]
    );
  }

  async markCandidateValidityByTopicCard(
    topicCardId: number,
    validityStatus: TopicValidityStatus,
    validityReason: string | null
  ) {
    await this.pool.query(
      `UPDATE topic_candidates tc
       JOIN topic_cards tcard ON tcard.topic_candidate_id = tc.id
       SET tc.validity_status = ?,
           tc.validity_reason = ?,
           tc.checked_at = CURRENT_TIMESTAMP
       WHERE tcard.id = ?`,
      [validityStatus, validityReason, topicCardId]
    );
  }

  async pruneCandidates(candidateIds: number[]) {
    if (candidateIds.length === 0) {
      return;
    }

    const placeholders = candidateIds.map(() => "?").join(", ");
    await this.pool.query(
      `UPDATE topic_candidates
       SET status = 'blocked_duplicate'
       WHERE id IN (${placeholders})`,
      candidateIds
    );
  }

  async createTopicCard(candidateId: number, summaryText: string, outputJson: string) {
    const [result] = await this.pool.query<ResultSetHeader>(
      `INSERT INTO topic_cards (topic_candidate_id, summary_text, output_json)
       VALUES (?, ?, ?)`,
      [candidateId, summaryText, outputJson]
    );
    return result.insertId;
  }

  async createDraft(topicCardId: number, draftType: string, content: string, summaryText: string | null, outputJson: string) {
    const [result] = await this.pool.query<ResultSetHeader>(
      `INSERT INTO drafts (topic_card_id, draft_type, content, summary_text, output_json)
       VALUES (?, ?, ?, ?, ?)`,
      [topicCardId, draftType, content, summaryText, outputJson]
    );
    return result.insertId;
  }

  async createReview(input: {
    draftId: number;
    reviewStatus: string;
    hardGateJson: string;
    editorialReviewJson: string;
    publishReviewJson: string;
    topicDuplicationJson: string;
    contentDuplicationJson: string;
    approvedContent: string | null;
    reviewSummary: string | null;
  }) {
    const [result] = await this.pool.query<ResultSetHeader>(
      `INSERT INTO reviews (
         draft_id,
         review_status,
         hard_gate_json,
         editorial_review_json,
         publish_review_json,
         topic_duplication_json,
         content_duplication_json,
         approved_content,
         review_summary
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.draftId,
        input.reviewStatus,
        input.hardGateJson,
        input.editorialReviewJson,
        input.publishReviewJson,
        input.topicDuplicationJson,
        input.contentDuplicationJson,
        input.approvedContent,
        input.reviewSummary
      ]
    );
    return result.insertId;
  }

  async getRecentPublishedTopicFingerprints(limit = 10) {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT tc.question_title, tcard.summary_text, tcard.output_json
       FROM publish_jobs pj
       JOIN topic_cards tcard ON tcard.id = pj.topic_card_id
       JOIN topic_candidates tc ON tc.id = tcard.topic_candidate_id
       WHERE pj.status = 'published'
       ORDER BY pj.finished_at DESC, pj.created_at DESC
       LIMIT ?`,
      [limit]
    );

    return rows.map((row) => ({
      title: row.question_title as string,
      summary: row.summary_text as string,
      topicCardJson: row.output_json as string
    }));
  }

  async getRecentPublishedContentFingerprints(limit = 10) {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT tc.question_title, rv.approved_content, draft.output_json
       FROM publish_jobs pj
       JOIN topic_cards tcard ON tcard.id = pj.topic_card_id
       JOIN topic_candidates tc ON tc.id = tcard.topic_candidate_id
       JOIN reviews rv ON rv.id = pj.review_id
       JOIN drafts draft ON draft.id = rv.draft_id
       WHERE pj.status = 'published'
       ORDER BY pj.finished_at DESC, pj.created_at DESC
       LIMIT ?`,
      [limit]
    );

    return rows.map((row) => ({
      title: row.question_title as string,
      content: (row.approved_content as string | null) ?? "",
      draftJson: row.output_json as string
    }));
  }

  async getTopicCardById(topicCardId: number) {
    const [rows] = await this.pool.query<TopicCardRow[]>(`SELECT * FROM topic_cards WHERE id = ? LIMIT 1`, [topicCardId]);
    return rows[0] ?? null;
  }

  async getLatestDraftForTopicCard(topicCardId: number, draftType: string) {
    const [rows] = await this.pool.query<DraftRow[]>(
      `SELECT * FROM drafts WHERE topic_card_id = ? AND draft_type = ? ORDER BY id DESC LIMIT 1`,
      [topicCardId, draftType]
    );
    return rows[0] ?? null;
  }

  async getReviewById(reviewId: number) {
    const [rows] = await this.pool.query<ReviewRow[]>(`SELECT * FROM reviews WHERE id = ? LIMIT 1`, [reviewId]);
    return rows[0] ?? null;
  }
}

function safeParseStringArray(value: string | null) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function mergeSourceMetadata(existingValue: string | null, sourceType: string, sourceMetadata: unknown) {
  const existing = safeParseRecord(existingValue);
  const existingSources = Array.isArray(existing.discoveredSources)
    ? existing.discoveredSources.map((item) => String(item)).filter(Boolean)
    : [];
  const discoveredSources = [...new Set([...existingSources, sourceType])];
  const sourceEvents = Array.isArray(existing.sourceEvents) ? existing.sourceEvents.filter((item) => item && typeof item === "object") : [];

  return {
    ...existing,
    latestSourceType: sourceType,
    discoveredSources,
    sourceEvents: [
      ...sourceEvents,
      {
        sourceType,
        metadata: sourceMetadata,
        discoveredAt: new Date().toISOString()
      }
    ].slice(-10)
  };
}

function safeParseRecord(value: string | null) {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
