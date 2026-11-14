import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveEtlConfig } from '../src/etl/config.ts';

describe('运行配置', () => {
  it('未设置 DATABASE_PATH 时使用默认数据库路径', () => {
    expect(resolveEtlConfig({}).databasePath).toBe(resolve('.data/database.db'));
  });

  it('DATABASE_PATH 指向指定的数据库文件', () => {
    const config = resolveEtlConfig({ DATABASE_PATH: '/tmp/wb-e2e/database.db' });
    expect(config.databasePath).toBe(resolve('/tmp/wb-e2e/database.db'));
  });

  it('空白 DATABASE_PATH 回退到默认路径', () => {
    const config = resolveEtlConfig({ DATABASE_PATH: '   ' });
    expect(config.databasePath).toBe(resolve('.data/database.db'));
  });

  it('WORKBUDDY_HOME 与 DATABASE_PATH 可同时指定', () => {
    const config = resolveEtlConfig({
      WORKBUDDY_HOME: '/tmp/wb-home',
      DATABASE_PATH: '/tmp/wb-e2e/database.db',
    });
    expect(config.workbuddyHome).toBe(resolve('/tmp/wb-home'));
    expect(config.databasePath).toBe(resolve('/tmp/wb-e2e/database.db'));
  });
});
