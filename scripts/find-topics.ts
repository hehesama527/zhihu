import { getMysqlPool } from '../packages/core/src/db/mysql.js';

async function main() {
  const pool = getMysqlPool();
  // 查找已回答过的问题，或者 topic_candidates 中的问题
  const [candidates] = await pool.query(`
    SELECT tc.id, tc.question_url, tc.question_title, tc.status, tc.account_id
    FROM topic_candidates tc
    ORDER BY tc.created_at DESC
    LIMIT 10
  `);
  console.log('📋 Topic Candidates:');
  console.log(JSON.stringify(candidates, null, 2));
  
  const [answered] = await pool.query(`
    SELECT at.id, at.question_url, at.question_title, at.account_id, at.answer_url
    FROM answered_topics at
    ORDER BY at.answered_at DESC
    LIMIT 10
  `);
  console.log('\n📋 已回答问题:');
  console.log(JSON.stringify(answered, null, 2));
  
  await pool.end();
}

main();
