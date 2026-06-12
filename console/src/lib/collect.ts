import type { CollectedFile } from '../types';

export interface Collection {
  files: CollectedFile[];
  /** 拖入的是单个根文件夹时为其名字（relPath 已去掉该前缀），否则为 null */
  rootName: string | null;
}

const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

function isJunk(relPath: string): boolean {
  const parts = relPath.split('/');
  return parts.some((p) => JUNK.has(p) || p === '__MACOSX');
}

/**
 * readEntries 每次最多返回 100 条（Chrome 实现限制），必须循环调用直到返回空数组。
 */
async function readAllEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    all.push(...batch);
  }
  return all;
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: CollectedFile[],
): Promise<void> {
  if (entry.isFile) {
    const file = await fileFromEntry(entry as FileSystemFileEntry);
    out.push({ relPath: prefix + entry.name, file });
  } else if (entry.isDirectory) {
    const children = await readAllEntries(entry as FileSystemDirectoryEntry);
    for (const child of children) {
      await walkEntry(child, prefix + entry.name + '/', out);
    }
  }
}

/** 从 drop 事件的 DataTransfer 收集文件（支持文件夹递归）。 */
export async function collectFromDataTransfer(dt: DataTransfer): Promise<Collection> {
  // webkitGetAsEntry 必须在任何 await 之前同步取完，否则 items 失效
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry();
    if (entry) entries.push(entry);
  }

  const out: CollectedFile[] = [];
  let rootName: string | null = null;

  if (entries.length === 1 && entries[0].isDirectory) {
    // 单个根文件夹：去掉根前缀，文件夹名作为默认 slug 来源
    rootName = entries[0].name;
    const children = await readAllEntries(entries[0] as FileSystemDirectoryEntry);
    for (const child of children) await walkEntry(child, '', out);
  } else {
    for (const entry of entries) await walkEntry(entry, '', out);
  }

  return { files: out.filter((f) => !isJunk(f.relPath)), rootName };
}

/** 从 <input type="file" webkitdirectory> 的 FileList 收集。 */
export function collectFromFileList(list: FileList): Collection {
  const raw = Array.from(list).map((file) => ({
    relPath: file.webkitRelativePath || file.name,
    file,
  }));
  const roots = new Set(raw.map((f) => f.relPath.split('/')[0]));
  if (roots.size === 1 && raw.length > 0 && raw.every((f) => f.relPath.includes('/'))) {
    const rootName = raw[0].relPath.split('/')[0];
    return {
      files: raw
        .map((f) => ({ relPath: f.relPath.split('/').slice(1).join('/'), file: f.file }))
        .filter((f) => f.relPath && !isJunk(f.relPath)),
      rootName,
    };
  }
  return { files: raw.filter((f) => !isJunk(f.relPath)), rootName: null };
}

/** 文件夹名 → 合法 slug：小写、非法字符转中划线。 */
export function slugify(name: string): string {
  let s = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!/^[a-z0-9]/.test(s)) s = s ? `site-${s}`.slice(0, 64) : 'site';
  return s;
}
