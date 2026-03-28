import type { Pool, RowDataPacket } from "mysql2/promise";

export const schemaSql = `
CREATE TABLE IF NOT EXISTS accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  zhihu_user_name VARCHAR(255) NULL,
  writer_prompt_version_id INT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'active',
  status_reason LONGTEXT NULL,
  profile_dir VARCHAR(512) NULL,
  last_login_check_at DATETIME NULL,
  last_publish_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS topic_candidates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NULL,
  question_url VARCHAR(1024) NOT NULL,
  question_title VARCHAR(512) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  source_metadata_text LONGTEXT NULL,
  priority VARCHAR(16) NULL,
  fit_score INT NULL,
  question_type VARCHAR(64) NULL,
  persona_mode VARCHAR(64) NULL,
  must_avoid_text LONGTEXT NULL,
  risk_notes_text LONGTEXT NULL,
  validity_status VARCHAR(64) NOT NULL DEFAULT 'unchecked',
  validity_reason LONGTEXT NULL,
  checked_at DATETIME NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'new',
  duplication_fingerprint_text LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_topic_candidates_account_status (account_id, status, validity_status, created_at)
);

CREATE TABLE IF NOT EXISTS topic_cards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  topic_candidate_id INT NOT NULL,
  summary_text LONGTEXT NOT NULL,
  output_json LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_topic_cards_candidate FOREIGN KEY (topic_candidate_id) REFERENCES topic_candidates(id)
);

CREATE TABLE IF NOT EXISTS drafts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  topic_card_id INT NOT NULL,
  draft_type VARCHAR(64) NOT NULL,
  content LONGTEXT NOT NULL,
  summary_text LONGTEXT NULL,
  output_json LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_drafts_topic_card FOREIGN KEY (topic_card_id) REFERENCES topic_cards(id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  draft_id INT NOT NULL,
  review_status VARCHAR(64) NOT NULL,
  hard_gate_json LONGTEXT NOT NULL,
  editorial_review_json LONGTEXT NOT NULL,
  publish_review_json LONGTEXT NOT NULL,
  topic_duplication_json LONGTEXT NOT NULL,
  content_duplication_json LONGTEXT NOT NULL,
  approved_content LONGTEXT NULL,
  review_summary LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reviews_draft FOREIGN KEY (draft_id) REFERENCES drafts(id)
);

CREATE TABLE IF NOT EXISTS publish_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL,
  topic_card_id INT NULL,
  review_id INT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'queued',
  title VARCHAR(512) NULL,
  scheduled_at DATETIME NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  final_url VARCHAR(1024) NULL,
  retry_count INT NOT NULL DEFAULT 0,
  failure_reason LONGTEXT NULL,
  prompt_version_snapshot_json LONGTEXT NULL,
  current_stage VARCHAR(64) NULL,
  resume_anchor_json LONGTEXT NULL,
  last_trace_id VARCHAR(128) NULL,
  last_error_type VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_publish_jobs_account FOREIGN KEY (account_id) REFERENCES accounts(id),
  CONSTRAINT fk_publish_jobs_topic_card FOREIGN KEY (topic_card_id) REFERENCES topic_cards(id),
  CONSTRAINT fk_publish_jobs_review FOREIGN KEY (review_id) REFERENCES reviews(id)
);

CREATE TABLE IF NOT EXISTS answered_topics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NULL,
  question_url_hash CHAR(64) NOT NULL,
  question_url VARCHAR(1024) NOT NULL,
  question_title VARCHAR(512) NOT NULL,
  topic_candidate_id INT NULL,
  topic_card_id INT NULL,
  review_id INT NULL,
  publish_job_id INT NULL,
  answer_url VARCHAR(1024) NULL,
  answered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_answered_topics_question_hash (question_url_hash),
  INDEX idx_answered_topics_account_answered (account_id, answered_at),
  INDEX idx_answered_topics_publish_job (publish_job_id),
  CONSTRAINT fk_answered_topics_account FOREIGN KEY (account_id) REFERENCES accounts(id),
  CONSTRAINT fk_answered_topics_candidate FOREIGN KEY (topic_candidate_id) REFERENCES topic_candidates(id),
  CONSTRAINT fk_answered_topics_topic_card FOREIGN KEY (topic_card_id) REFERENCES topic_cards(id),
  CONSTRAINT fk_answered_topics_review FOREIGN KEY (review_id) REFERENCES reviews(id),
  CONSTRAINT fk_answered_topics_job FOREIGN KEY (publish_job_id) REFERENCES publish_jobs(id)
);

CREATE TABLE IF NOT EXISTS publish_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  publish_job_id INT NOT NULL,
  attempt_no INT NOT NULL,
  status VARCHAR(64) NOT NULL,
  current_url VARCHAR(1024) NULL,
  failure_type VARCHAR(128) NULL,
  failure_reason LONGTEXT NULL,
  attempt_json LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_publish_attempts_job FOREIGN KEY (publish_job_id) REFERENCES publish_jobs(id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  publish_attempt_id INT NULL,
  artifact_type VARCHAR(64) NOT NULL,
  file_path VARCHAR(1024) NOT NULL,
  meta_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_artifacts_attempt FOREIGN KEY (publish_attempt_id) REFERENCES publish_attempts(id)
);

CREATE TABLE IF NOT EXISTS tool_traces (
  id INT AUTO_INCREMENT PRIMARY KEY,
  publish_job_id INT NULL,
  publish_attempt_id INT NULL,
  trace_id VARCHAR(128) NOT NULL,
  stage VARCHAR(64) NOT NULL,
  tool_name VARCHAR(64) NOT NULL,
  action VARCHAR(32) NOT NULL,
  input_json LONGTEXT NOT NULL,
  result_json LONGTEXT NULL,
  artifact_path VARCHAR(1024) NULL,
  duration_ms INT NULL,
  success TINYINT(1) NOT NULL DEFAULT 1,
  error_message LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tool_traces_job (publish_job_id, created_at),
  INDEX idx_tool_traces_trace (trace_id),
  CONSTRAINT fk_tool_traces_job FOREIGN KEY (publish_job_id) REFERENCES publish_jobs(id),
  CONSTRAINT fk_tool_traces_attempt FOREIGN KEY (publish_attempt_id) REFERENCES publish_attempts(id)
);

CREATE TABLE IF NOT EXISTS skill_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  publish_job_id INT NULL,
  publish_attempt_id INT NULL,
  skill_name VARCHAR(64) NOT NULL,
  agent_name VARCHAR(128) NOT NULL,
  stage VARCHAR(64) NULL,
  trace_id VARCHAR(128) NULL,
  input_json LONGTEXT NOT NULL,
  output_json LONGTEXT NULL,
  duration_ms INT NULL,
  success TINYINT(1) NOT NULL DEFAULT 1,
  error_message LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_skill_runs_job (publish_job_id, created_at),
  INDEX idx_skill_runs_trace (trace_id),
  CONSTRAINT fk_skill_runs_job FOREIGN KEY (publish_job_id) REFERENCES publish_jobs(id),
  CONSTRAINT fk_skill_runs_attempt FOREIGN KEY (publish_attempt_id) REFERENCES publish_attempts(id)
);

CREATE TABLE IF NOT EXISTS daily_publish_schedule (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NULL,
  schedule_date DATE NOT NULL,
  scheduled_at DATETIME NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'pending',
  publish_job_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_schedule_slot_account (account_id, schedule_date, scheduled_at),
  INDEX idx_schedule_account_date (account_id, schedule_date, scheduled_at),
  CONSTRAINT fk_schedule_job FOREIGN KEY (publish_job_id) REFERENCES publish_jobs(id),
  CONSTRAINT fk_schedule_account FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS prompt_sets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  prompt_set_id INT NOT NULL,
  version INT NOT NULL,
  label VARCHAR(255) NOT NULL,
  content LONGTEXT NOT NULL,
  notes LONGTEXT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_prompt_set_version (prompt_set_id, version),
  CONSTRAINT fk_prompt_versions_set FOREIGN KEY (prompt_set_id) REFERENCES prompt_sets(id)
);

CREATE TABLE IF NOT EXISTS prompt_activations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  prompt_set_id INT NOT NULL,
  prompt_version_id INT NOT NULL,
  activated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prompt_activations_set FOREIGN KEY (prompt_set_id) REFERENCES prompt_sets(id),
  CONSTRAINT fk_prompt_activations_version FOREIGN KEY (prompt_version_id) REFERENCES prompt_versions(id)
);

CREATE TABLE IF NOT EXISTS prompt_test_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  prompt_version_id INT NOT NULL,
  input_json LONGTEXT NOT NULL,
  output_json LONGTEXT NULL,
  error_text LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prompt_test_runs_version FOREIGN KEY (prompt_version_id) REFERENCES prompt_versions(id)
);
`;

type ColumnMigration = {
  table: string;
  column: string;
  ddl: string;
};

const columnMigrations: ColumnMigration[] = [
  {
    table: "accounts",
    column: "status_reason",
    ddl: "ALTER TABLE accounts ADD COLUMN status_reason LONGTEXT NULL AFTER status"
  },
  {
    table: "accounts",
    column: "writer_prompt_version_id",
    ddl: "ALTER TABLE accounts ADD COLUMN writer_prompt_version_id INT NULL AFTER zhihu_user_name"
  },
  {
    table: "topic_candidates",
    column: "account_id",
    ddl: "ALTER TABLE topic_candidates ADD COLUMN account_id INT NULL AFTER id"
  },
  {
    table: "topic_candidates",
    column: "priority",
    ddl: "ALTER TABLE topic_candidates ADD COLUMN priority VARCHAR(16) NULL AFTER source_metadata_text"
  },
  {
    table: "topic_candidates",
    column: "fit_score",
    ddl: "ALTER TABLE topic_candidates ADD COLUMN fit_score INT NULL AFTER priority"
  },
  {
    table: "topic_candidates",
    column: "question_type",
    ddl: "ALTER TABLE topic_candidates ADD COLUMN question_type VARCHAR(64) NULL AFTER fit_score"
  },
  {
    table: "topic_candidates",
    column: "persona_mode",
    ddl: "ALTER TABLE topic_candidates ADD COLUMN persona_mode VARCHAR(64) NULL AFTER question_type"
  },
  {
    table: "topic_candidates",
    column: "must_avoid_text",
    ddl: "ALTER TABLE topic_candidates ADD COLUMN must_avoid_text LONGTEXT NULL AFTER persona_mode"
  },
  {
    table: "topic_candidates",
    column: "risk_notes_text",
    ddl: "ALTER TABLE topic_candidates ADD COLUMN risk_notes_text LONGTEXT NULL AFTER must_avoid_text"
  },
  {
    table: "topic_candidates",
    column: "validity_status",
    ddl: "ALTER TABLE topic_candidates ADD COLUMN validity_status VARCHAR(64) NOT NULL DEFAULT 'unchecked' AFTER risk_notes_text"
  },
  {
    table: "topic_candidates",
    column: "validity_reason",
    ddl: "ALTER TABLE topic_candidates ADD COLUMN validity_reason LONGTEXT NULL AFTER validity_status"
  },
  {
    table: "topic_candidates",
    column: "checked_at",
    ddl: "ALTER TABLE topic_candidates ADD COLUMN checked_at DATETIME NULL AFTER validity_reason"
  },
  {
    table: "publish_jobs",
    column: "prompt_version_snapshot_json",
    ddl: "ALTER TABLE publish_jobs ADD COLUMN prompt_version_snapshot_json LONGTEXT NULL AFTER failure_reason"
  },
  {
    table: "publish_jobs",
    column: "current_stage",
    ddl: "ALTER TABLE publish_jobs ADD COLUMN current_stage VARCHAR(64) NULL AFTER prompt_version_snapshot_json"
  },
  {
    table: "publish_jobs",
    column: "resume_anchor_json",
    ddl: "ALTER TABLE publish_jobs ADD COLUMN resume_anchor_json LONGTEXT NULL AFTER current_stage"
  },
  {
    table: "publish_jobs",
    column: "last_trace_id",
    ddl: "ALTER TABLE publish_jobs ADD COLUMN last_trace_id VARCHAR(128) NULL AFTER resume_anchor_json"
  },
  {
    table: "publish_jobs",
    column: "last_error_type",
    ddl: "ALTER TABLE publish_jobs ADD COLUMN last_error_type VARCHAR(128) NULL AFTER last_trace_id"
  },
  {
    table: "daily_publish_schedule",
    column: "account_id",
    ddl: "ALTER TABLE daily_publish_schedule ADD COLUMN account_id INT NULL AFTER id"
  }
];

const rawMigrations = [
  "ALTER TABLE publish_jobs MODIFY COLUMN topic_card_id INT NULL",
  "ALTER TABLE publish_jobs MODIFY COLUMN review_id INT NULL",
  "ALTER TABLE publish_jobs MODIFY COLUMN title VARCHAR(512) NULL",
  "ALTER TABLE publish_jobs MODIFY COLUMN status VARCHAR(64) NOT NULL DEFAULT 'queued'"
];

type IndexMigration = {
  table: string;
  index: string;
  ddl: string;
};

const dropIndexMigrations: IndexMigration[] = [
  {
    table: "daily_publish_schedule",
    index: "uniq_schedule_slot",
    ddl: "ALTER TABLE daily_publish_schedule DROP INDEX uniq_schedule_slot"
  }
];

const addIndexMigrations: IndexMigration[] = [
  {
    table: "topic_candidates",
    index: "idx_topic_candidates_account_status",
    ddl: "ALTER TABLE topic_candidates ADD INDEX idx_topic_candidates_account_status (account_id, status, validity_status, created_at)"
  },
  {
    table: "daily_publish_schedule",
    index: "uniq_schedule_slot_account",
    ddl: "ALTER TABLE daily_publish_schedule ADD UNIQUE KEY uniq_schedule_slot_account (account_id, schedule_date, scheduled_at)"
  },
  {
    table: "daily_publish_schedule",
    index: "idx_schedule_account_date",
    ddl: "ALTER TABLE daily_publish_schedule ADD INDEX idx_schedule_account_date (account_id, schedule_date, scheduled_at)"
  }
];

export async function applySchemaMigrations(pool: Pool) {
  await pool.query(schemaSql);

  for (const migration of columnMigrations) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?`,
      [migration.table, migration.column]
    );

    if (Number(rows[0]?.count ?? 0) === 0) {
      await pool.query(migration.ddl);
    }
  }

  for (const ddl of rawMigrations) {
    await pool.query(ddl);
  }

  for (const migration of dropIndexMigrations) {
    if (await hasIndex(pool, migration.table, migration.index)) {
      await pool.query(migration.ddl);
    }
  }

  for (const migration of addIndexMigrations) {
    if (!(await hasIndex(pool, migration.table, migration.index))) {
      await pool.query(migration.ddl);
    }
  }

  await backfillAnsweredTopics(pool);
}

async function hasIndex(pool: Pool, table: string, index: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [table, index]
  );

  return Number(rows[0]?.count ?? 0) > 0;
}

async function backfillAnsweredTopics(pool: Pool) {
  await pool.query(
    `INSERT INTO answered_topics (
       account_id,
       question_url_hash,
       question_url,
       question_title,
       topic_candidate_id,
       topic_card_id,
       review_id,
       publish_job_id,
       answer_url,
       answered_at
     )
     SELECT
       pj.account_id,
       LOWER(SHA2(tc.question_url, 256)),
       tc.question_url,
       tc.question_title,
       tc.id,
       tcard.id,
       pj.review_id,
       pj.id,
       pj.final_url,
       COALESCE(pj.finished_at, pj.updated_at, pj.created_at)
     FROM publish_jobs pj
     JOIN topic_cards tcard ON tcard.id = pj.topic_card_id
     JOIN topic_candidates tc ON tc.id = tcard.topic_candidate_id
     WHERE pj.status = 'published'
       AND tc.question_url IS NOT NULL
       AND tc.question_url <> ''
     ON DUPLICATE KEY UPDATE
       account_id = COALESCE(VALUES(account_id), answered_topics.account_id),
       question_url = VALUES(question_url),
       question_title = VALUES(question_title),
       topic_candidate_id = COALESCE(VALUES(topic_candidate_id), answered_topics.topic_candidate_id),
       topic_card_id = COALESCE(VALUES(topic_card_id), answered_topics.topic_card_id),
       review_id = COALESCE(VALUES(review_id), answered_topics.review_id),
       publish_job_id = COALESCE(VALUES(publish_job_id), answered_topics.publish_job_id),
       answer_url = COALESCE(VALUES(answer_url), answered_topics.answer_url),
       answered_at = GREATEST(answered_topics.answered_at, VALUES(answered_at))`
  );
}
