import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** 运行配置：WorkBuddy 数据根目录与数据库路径都由调用方注入，便于测试切换。 */
export interface EtlConfig {
  workbuddyHome: string;
  databasePath: string;
}

export function resolveEtlConfig(env: NodeJS.ProcessEnv = process.env): EtlConfig {
  const home = env.WORKBUDDY_HOME?.trim();
  const configuredPath = env.DATABASE_PATH?.trim();
  return {
    workbuddyHome: resolve(home && home.length > 0 ? home : join(homedir(), '.workbuddy')),
    databasePath: resolve(
      configuredPath && configuredPath.length > 0 ? configuredPath : '.data/database.db',
    ),
  };
}

/** WorkBuddy 数据库与 projects 目录的固定相对位置。 */
export function externalDbPath(workbuddyHome: string): string {
  return resolve(workbuddyHome, 'workbuddy.db');
}

export function projectsRoot(workbuddyHome: string): string {
  return resolve(workbuddyHome, 'projects');
}
