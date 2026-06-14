/** Node 端 DB 工厂:better-sqlite3 + WAL,启动建表(Node only,勿被 edge 代码 import)。 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { DDL } from './ddl.js';
import * as schema from './schema.js';

export function createNodeDb(file: string) {
  mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(DDL);
  migrate(sqlite);
  return drizzle(sqlite, { schema });
}

/** 增量列迁移:CREATE TABLE IF NOT EXISTS 不会给存量库加列,这里按列名补齐。
 * (新增的整张表走 DDL 的 CREATE TABLE IF NOT EXISTS,无需在此处理。) */
function migrate(sqlite: InstanceType<typeof Database>): void {
  const colsOf = (table: string) =>
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

  const threadCols = colsOf('comment_threads');
  if (!threadCols.includes('rw')) {
    sqlite.exec('ALTER TABLE comment_threads ADD COLUMN rw REAL; ALTER TABLE comment_threads ADD COLUMN rh REAL;');
  }

  const userCols = colsOf('users');
  if (!userCols.includes('disabled')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;');
  }
}

export type Db = ReturnType<typeof createNodeDb>;
