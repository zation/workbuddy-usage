import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { readExternalSnapshot } from '../src/etl/external.ts';
import { scanSourceFiles } from '../src/etl/scan.ts';
import { createWorkbuddyDb } from './helpers/external-db.ts';
import { cleanupTempDirs, makeTempDir } from './helpers/temp.ts';

function write(workbuddyHome: string, relativePath: string, content: string): string {
  const absolute = join(workbuddyHome, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

afterEach(() => {
  cleanupTempDirs();
});

describe('扫描会话事件流', () => {
  it('识别主会话与子代理，排除 ndjson 与无关文件', () => {
    const home = makeTempDir();
    const mainPath = write(home, 'projects/enc1/s1.jsonl', '{"a":1}\n');
    const subPath = write(home, 'projects/enc1/s1/subagents/agent-a.jsonl', '{"b":2}\n');
    write(home, 'projects/enc1/s1.file-rollback.ndjson', '{}\n');
    write(home, 'projects/enc1/notes.txt', 'x');
    write(home, 'projects/enc2/s2.jsonl', '{"c":3}\n');
    write(home, 'projects/enc2/s2/other/x.jsonl', '{"d":4}\n');

    const result = scanSourceFiles(home);
    expect(result.unrecognizedFiles).toBe(1);
    expect(result.files.map((file) => file.path)).toEqual([mainPath, subPath, join(home, 'projects/enc2/s2.jsonl')]);

    const main = result.files.find((file) => file.path === mainPath);
    expect(main).toMatchObject({
      kind: 'main',
      sessionKey: 's1',
      subSessionKey: null,
      sizeBytes: 8,
    });
    expect(Number.isInteger(main?.mtimeMs)).toBe(true);

    const subagent = result.files.find((file) => file.path === subPath);
    expect(subagent).toMatchObject({
      kind: 'subagent',
      sessionKey: 's1',
      subSessionKey: 'agent-a',
    });
  });

  it('projects 目录缺失时返回空结果', () => {
    const home = makeTempDir();
    expect(scanSourceFiles(home)).toEqual({ files: [], unrecognizedFiles: 0 });
  });
});

describe('WorkBuddy 数据库只读访问', () => {
  it('读取 sessions 与 credit_json，并记录异常积分告警', () => {
    const home = makeTempDir();
    createWorkbuddyDb(
      home,
      [
        { id: 's1', cwd: '/work/demo', title: '标题', customTitle: '自定义', model: 'm1' },
        { id: 's2', cwd: '', title: '', model: '' },
      ],
      [
        { sessionId: 's1', creditJson: '{"r1":1.5,"r2":0}' },
        { sessionId: 's2', creditJson: null },
        { sessionId: 's3', creditJson: '{}' },
        { sessionId: 's4', creditJson: '{oops' },
        { sessionId: 's5', creditJson: '{"r3":"1"}' },
        { sessionId: 's6', creditJson: '{"r1":9}' },
      ],
    );

    const snapshot = readExternalSnapshot(home);
    expect(snapshot.available).toBe(true);
    expect(snapshot.sessions.get('s1')).toMatchObject({
      cwd: '/work/demo',
      title: '标题',
      customTitle: '自定义',
      model: 'm1',
    });
    expect(snapshot.sessions.get('s2')).toMatchObject({
      cwd: null,
      title: null,
      model: null,
    });
    expect([...snapshot.credits.entries()]).toEqual([
      ['r1', 1.5],
      ['r2', 0],
    ]);
    expect(snapshot.warnings).toEqual({
      invalidCreditJson: 1,
      nonNumericCredits: 1,
      duplicateCredits: 1,
    });
  });

  it('库不存在时返回不可用快照', () => {
    const home = makeTempDir();
    const snapshot = readExternalSnapshot(home);
    expect(snapshot.available).toBe(false);
    expect(snapshot.sessions.size).toBe(0);
    expect(snapshot.credits.size).toBe(0);
  });

  it('只读连接拒绝写入', () => {
    const home = makeTempDir();
    const dbPath = createWorkbuddyDb(home, [{ id: 's1', cwd: '/a' }], []);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    expect(() => db.exec('DELETE FROM sessions')).toThrow();
    expect(() => db.exec("INSERT INTO sessions (id) VALUES ('x')")).toThrow();
    expect(() => db.exec('CREATE TABLE probe (id INTEGER)')).toThrow();
    db.close();
  });
});
