/** 方言列工具箱 —— 让 schema-factory.ts 用一份表定义生成 sqlite / pg / mysql 三套 drizzle table。
 *
 * 设计取舍:类型刻意放松成 any。工厂只需保证【运行时】DDL 与取值映射正确
 * (由 drizzle-kit 生成的迁移 + Docker 集成测试验证);对外暴露的精确类型一律在 db/index.ts
 * 里把激活方言的 table cast 成规范 sqlite schema 的类型,故此处无需追求编译期精度。
 *
 * 字符串长度:只有 mysql 需要(VARCHAR(n) 才能进主键/索引;TEXT 不能无前缀索引)。
 * sqlite/pg 忽略 len。索引里用到的字符串都给了「足够且让 utf8mb4 复合索引 ≤3072B」的长度。
 */
import {
  index as sqIndex,
  integer as sqInt,
  real as sqReal,
  sqliteTable,
  text as sqText,
  uniqueIndex as sqUnique,
} from 'drizzle-orm/sqlite-core';
import {
  boolean as pgBool,
  doublePrecision as pgDouble,
  index as pgIndex,
  integer as pgInt,
  jsonb as pgJsonb,
  pgTable,
  text as pgText,
  uniqueIndex as pgUnique,
  varchar as pgVarchar,
} from 'drizzle-orm/pg-core';
import {
  boolean as myBool,
  double as myDouble,
  index as myIndex,
  int as myInt,
  json as myJson,
  mysqlTable,
  text as myText,
  uniqueIndex as myUnique,
  varchar as myVarchar,
} from 'drizzle-orm/mysql-core';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Col = any;
type Tbl = any;

export type Dialect = 'sqlite' | 'pg' | 'mysql';

export interface ColumnKit {
  dialect: Dialect;
  table: (name: string, cols: Record<string, Col>, extra?: (t: any) => any[]) => Tbl;
  /** 有界字符串(可进主键/索引);mysql=VARCHAR(len)。len 默认 255。 */
  str: (name: string, len?: number) => Col;
  /** 无界、非索引的大文本;mysql=TEXT。 */
  longStr: (name: string) => Col;
  bool: (name: string) => Col;
  int: (name: string) => Col;
  real: (name: string) => Col;
  /** JSON 列;调用方按需 .$type<T>()。pg=jsonb, mysql=json, sqlite=text(mode:json)。 */
  json: (name: string) => Col;
  unique: (name: string) => { on: (...c: Col[]) => Col };
  index: (name: string) => { on: (...c: Col[]) => Col };
}

const DEFAULT_LEN = 255;

export const sqliteKit: ColumnKit = {
  dialect: 'sqlite',
  table: (n, c, e) => (e ? (sqliteTable as any)(n, c, e) : sqliteTable(n, c)),
  str: (n) => sqText(n),
  longStr: (n) => sqText(n),
  bool: (n) => sqInt(n, { mode: 'boolean' }),
  int: (n) => sqInt(n),
  real: (n) => sqReal(n),
  json: (n) => sqText(n, { mode: 'json' }),
  unique: (n) => sqUnique(n),
  index: (n) => sqIndex(n),
};

export const pgKit: ColumnKit = {
  dialect: 'pg',
  table: (n, c, e) => (e ? (pgTable as any)(n, c, e) : pgTable(n, c)),
  str: (n, len = DEFAULT_LEN) => pgVarchar(n, { length: len }),
  longStr: (n) => pgText(n),
  bool: (n) => pgBool(n),
  int: (n) => pgInt(n),
  real: (n) => pgDouble(n),
  json: (n) => pgJsonb(n),
  unique: (n) => pgUnique(n),
  index: (n) => pgIndex(n),
};

export const mysqlKit: ColumnKit = {
  dialect: 'mysql',
  table: (n, c, e) => (e ? (mysqlTable as any)(n, c, e) : mysqlTable(n, c)),
  str: (n, len = DEFAULT_LEN) => myVarchar(n, { length: len }),
  longStr: (n) => myText(n),
  bool: (n) => myBool(n),
  int: (n) => myInt(n),
  real: (n) => myDouble(n),
  json: (n) => myJson(n),
  unique: (n) => myUnique(n),
  index: (n) => myIndex(n),
};

export const KITS: Record<Dialect, ColumnKit> = { sqlite: sqliteKit, pg: pgKit, mysql: mysqlKit };
