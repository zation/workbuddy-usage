import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** 运行配置：外部数据根目录与派生索引路径都由调用方注入，便于测试切换。 */
export interface EtlConfig {
  workbuddyHome: string;
  indexPath: string;
}

export function resolveEtlConfig(env: NodeJS.ProcessEnv = process.env): EtlConfig {
  const home = env.WORKBUDDY_HOME?.trim();
  return {
    workbuddyHome: resolve(home && home.length > 0 ? home : join(homedir(), '.workbuddy')),
    indexPath: resolve('.data/index.db'),
  };
}

/** 外部 sqlite 与 projects 目录的固定相对位置。 */
export function externalDbPath(config: EtlConfig): string {
  return resolve(config.workbuddyHome, 'workbuddy.db');
}

export function projectsRoot(config: EtlConfig): string {
  return resolve(config.workbuddyHome, 'projects');
}
