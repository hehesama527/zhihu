import mysql from "mysql2/promise";
import {
  AccountRepository,
  applySchemaMigrations,
  PromptRepository,
  PromptService,
  getMysqlPool,
  parseMysqlUrl,
} from "@zhihu-mvp/core";

const mysqlConfig = parseMysqlUrl();
const adminConnection = await mysql.createConnection({
  host: mysqlConfig.host,
  port: mysqlConfig.port,
  user: mysqlConfig.user,
  password: mysqlConfig.password,
  multipleStatements: true
});

await adminConnection.query(`CREATE DATABASE IF NOT EXISTS \`${mysqlConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await adminConnection.end();

const pool = getMysqlPool();
await applySchemaMigrations(pool);

const promptService = new PromptService(new PromptRepository(pool));
await promptService.bootstrapDefaults();

const accountRepository = new AccountRepository(pool);
await accountRepository.ensureDefaultAccount();

await pool.end();

console.log(`Database ${mysqlConfig.database} initialized successfully.`);
