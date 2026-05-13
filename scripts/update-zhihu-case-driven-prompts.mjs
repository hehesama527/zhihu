import { getMysqlPool } from "../packages/core/dist/core/src/db/mysql.js";
import { PromptRepository } from "../packages/core/dist/core/src/repositories/prompt-repository.js";

const MARKER = "CASE-DRIVEN-WRITING-V1";

const TOPIC_RULES = `

[${MARKER} topic rules]
1. For crypto, trading, altcoin, contract, strategy, backtesting, risk-control, trading-psychology, capital-size, and stable-profit topics, set writing_plan.should_use_cases=true by default unless the question is only a narrow factual definition.
2. Preserve concrete case material from sourceContext, backend case_research, user notes, titles, and candidate context in recommended_angle or writing_plan.writer_notes.
3. User-provided examples are style/quality references, not reusable copy. Do not keep reusing the same token, same price path, same story arc, or same wording across different answers.
4. A usable case should include time/price path or market setup, entry trigger, position/budget, long/short temptation, action deformation, outcome pressure, and review takeaway.
`;

const WRITER_RULES = `

[${MARKER} writer rules]
1. For crypto/trading topics, do not write only abstract principles. At least one concrete case should carry the main argument when writing_plan.should_use_cases=true.
2. Prefer fresh case material from sourceContext, backend case_research, or the specific topic context. If no reliable case is available, write a realistic typical/composite case with self-consistent numbers.
3. User-provided examples are style/quality references, not reusable text. Do not copy their wording, do not repeatedly use the same token, same price path, or same story arc across different answers.
4. A complete case action chain should include most of these: time/price path or market setup, entry trigger, position/budget, long/short temptation, stop-loss/take-profit action, emotional deformation, outcome pressure, and review takeaway.
5. If using source/backend/user case material, use cautious wording such as "based on this path" or "a similar pattern"; do not claim independent verification unless the input explicitly provides verified evidence.
6. After the case, extract what it proves and connect that lesson to practical method, risk boundary, review workflow, or the product workflow. The case is evidence, not decoration.
`;

const REVIEW_RULES = `

[${MARKER} review rules]
1. If writing_plan.should_use_cases=true, do not accept a draft whose cases are only generic mentions of liquidity, chips, psychology, or drawdown.
2. A publishable trading/crypto case should include a concrete action chain: time/price path or market setup, entry trigger, position/budget, long/short temptation, action deformation, outcome pressure, and review takeaway.
3. Allow realistic composite cases when they are not falsely presented as verified friends, exact personal records, or screenshot-backed facts.
4. If the draft copies user reference wording or keeps reusing the same token/story arc across different topics when other cases are available, ask for revision.
`;

async function activateWithAppend(repo, name, label, rules, notes) {
  const active = await repo.getActivePromptSnapshot(name);
  if (!active) {
    throw new Error(`No active ${name} prompt.`);
  }

  if (active.content.includes(MARKER)) {
    return active;
  }

  const draftId = await repo.createPromptDraft(name, label, `${active.content}${rules}`, notes);
  await repo.activatePromptVersion(draftId);
  return repo.getActivePromptSnapshot(name);
}

const pool = getMysqlPool();
const repo = new PromptRepository(pool);

try {
  const topic = await activateWithAppend(
    repo,
    "topic_agent",
    "Topic Agent v14",
    TOPIC_RULES,
    "Add reusable case-driven writing-plan rules and case diversity boundary."
  );
  const writer = await activateWithAppend(
    repo,
    "writer_agent",
    "Writer Agent v19",
    WRITER_RULES,
    "Require concrete case action chains, fresh case sourcing, and no reuse of user reference wording."
  );
  const review = await activateWithAppend(
    repo,
    "review_agent",
    "Review Agent v5",
    REVIEW_RULES,
    "Review under-developed or repeated cases when the writing plan requests cases."
  );

  console.log(
    JSON.stringify(
      {
        topic_agent: { id: topic?.promptVersionId, version: topic?.version, label: topic?.label },
        writer_agent: { id: writer?.promptVersionId, version: writer?.version, label: writer?.label },
        review_agent: { id: review?.promptVersionId, version: review?.version, label: review?.label }
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}
