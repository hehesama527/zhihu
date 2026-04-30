import { getMysqlPool } from '../packages/core/src/db/mysql.js';

async function main() {
  const pool = getMysqlPool();
  const [rows] = await pool.query('SELECT id, name, zhihu_user_name FROM accounts');
  console.log(JSON.stringify(rows, null, 2));
  await pool.end();
}

main();
