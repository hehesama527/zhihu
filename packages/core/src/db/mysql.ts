import mysql from "mysql2/promise";
import { getAppConfig } from "../config/env.js";

let pool: mysql.Pool | null = null;

export function parseMysqlUrl(connectionString = getAppConfig().mysqlUrl) {
  const url = new URL(connectionString);
  const database = url.pathname.replace(/^\//, "");

  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database
  };
}

export function getMysqlPool() {
  if (!pool) {
    const config = parseMysqlUrl();
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      multipleStatements: true,
      connectTimeout: resolveMysqlTimeout(process.env.MYSQL_CONNECT_TIMEOUT_MS, 5_000),
      enableKeepAlive: true,
      keepAliveInitialDelay: 0
    });
  }

  return pool;
}

function resolveMysqlTimeout(value: string | undefined, fallbackMs: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallbackMs;
}
