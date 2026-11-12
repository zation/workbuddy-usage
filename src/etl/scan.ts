import { existsSync, readdirSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import type { SourceFileKind, SourceFileRef } from '../shared/types.ts';
import { projectsRoot } from './config.ts';

export interface ScanResult {
  files: SourceFileRef[];
  unrecognizedFiles: number;
}

interface ClassifiedFile {
  path: string;
  kind: SourceFileKind;
  sessionKey: string;
  subSessionKey: string | null;
}

function stripExtension(fileName: string): string {
  return basename(fileName, '.jsonl');
}

/**
 * 只认两种布局：
 * projects/<编码cwd>/<sessionId>.jsonl
 * projects/<编码cwd>/<sessionId>/subagents/<agentId>.jsonl
 * 其余位置的 .jsonl 视为无法归属，跳过并计数。
 */
function classify(root: string, absolutePath: string): ClassifiedFile | null {
  const segments = relative(root, absolutePath).split(sep).filter((segment) => segment.length > 0);
  const fileName = segments.at(-1);
  if (!fileName) {
    return null;
  }

  if (segments.length === 2) {
    return {
      path: absolutePath,
      kind: 'main',
      sessionKey: stripExtension(fileName),
      subSessionKey: null,
    };
  }

  const subagentsIndex = segments.lastIndexOf('subagents');
  if (subagentsIndex >= 2 && subagentsIndex === segments.length - 2) {
    const parentSession = segments[subagentsIndex - 1];
    if (!parentSession) {
      return null;
    }
    return {
      path: absolutePath,
      kind: 'subagent',
      sessionKey: parentSession,
      subSessionKey: stripExtension(fileName),
    };
  }

  return null;
}

function walk(
  root: string,
  dir: string,
  files: ClassifiedFile[],
  counters: { unrecognizedFiles: number },
): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, absolutePath, files, counters);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
      continue;
    }
    const classified = classify(root, absolutePath);
    if (!classified) {
      counters.unrecognizedFiles += 1;
      continue;
    }
    files.push(classified);
  }
}

/** 扫描全部会话事件流，stat 在返回前一次性取，作为解析前的增量快照。 */
export function scanSourceFiles(workbuddyHome: string): ScanResult {
  const root = projectsRoot(workbuddyHome);
  const counters = { unrecognizedFiles: 0 };
  const classified: ClassifiedFile[] = [];

  if (existsSync(root)) {
    walk(root, root, classified, counters);
  }

  const files: SourceFileRef[] = [];
  for (const file of classified) {
    let stat;
    try {
      stat = statSync(file.path);
    } catch {
      continue;
    }
    files.push({
      ...file,
      sizeBytes: stat.size,
      mtimeMs: Math.floor(stat.mtimeMs),
    });
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, unrecognizedFiles: counters.unrecognizedFiles };
}
