export type CookiePickStrategy = 'round_robin' | 'random';

const COOKIE_POOL_VERSION = 2 as const;

export interface StoredCookieEnvelope {
  v: typeof COOKIE_POOL_VERSION;
  strategy: CookiePickStrategy;
  entries: string[];
}

const roundRobinCursor = new Map<number, number>();

function parseEnvelope(stored: string): StoredCookieEnvelope | null {
  const t = stored.trim();
  if (!t.startsWith('{')) {
    return null;
  }
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    if (
      o &&
      o.v === COOKIE_POOL_VERSION &&
      (o.strategy === 'round_robin' || o.strategy === 'random') &&
      Array.isArray(o.entries)
    ) {
      const entries = o.entries
        .filter((e): e is string => typeof e === 'string')
        .map(e => e.trim())
        .filter(Boolean);
      return {
        v: COOKIE_POOL_VERSION,
        strategy: o.strategy,
        entries,
      };
    }
  } catch {
    return null;
  }
  return null;
}

/** 前端表单：从 DB 字段解析为 strategy + 多行 */
export function decodeCookieStorageForForm(stored: string | null | undefined): {
  strategy: CookiePickStrategy;
  entries: string[];
} {
  if (!stored?.trim()) {
    return { strategy: 'round_robin', entries: [''] };
  }
  const env = parseEnvelope(stored);
  if (env) {
    return { strategy: env.strategy, entries: env.entries.length > 0 ? [...env.entries] : [''] };
  }
  return { strategy: 'round_robin', entries: [stored] };
}

/** 写入 DB：单条存原文，多条存 JSON 信封 */
export function encodeCookieStorageForDb(
  strategy: CookiePickStrategy,
  entries: string[],
): string | null {
  const trimmed = entries.map(e => e.trim()).filter(e => e.length > 0);
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length === 1) {
    return trimmed[0];
  }
  const payload: StoredCookieEnvelope = {
    v: COOKIE_POOL_VERSION,
    strategy,
    entries: trimmed,
  };
  return JSON.stringify(payload);
}

export function isCookieConfigured(stored: string | null | undefined): boolean {
  if (!stored?.trim()) {
    return false;
  }
  const env = parseEnvelope(stored);
  if (env) {
    return env.entries.length > 0;
  }
  return true;
}

export function formatCookieBadge(stored: string | null | undefined): string {
  if (!isCookieConfigured(stored)) {
    return '未配置 Cookie';
  }
  const env = parseEnvelope(stored!.trim());
  if (env && env.entries.length >= 2) {
    const mode = env.strategy === 'random' ? '随机' : '轮询';
    return `Cookie 池 ${env.entries.length} 组（${mode}）`;
  }
  return '已配置 Cookie';
}

/**
 * 每次任务执行选用一组 Cookie；轮询在进程内按 configId 递增（无持久化）。
 */
export function resolveCookieForRun(
  stored: string | null | undefined,
  configId: number,
): string | undefined {
  if (!stored?.trim()) {
    return undefined;
  }
  const env = parseEnvelope(stored);
  if (!env) {
    return stored.trim();
  }
  const entries = env.entries.map(e => e.trim()).filter(Boolean);
  if (entries.length === 0) {
    return undefined;
  }
  if (entries.length === 1) {
    return entries[0];
  }
  if (env.strategy === 'random') {
    const i = Math.floor(Math.random() * entries.length);
    console.log(`[cookie-pool] 随机选用第 ${i + 1}/${entries.length} 组（配置 #${configId}）`);
    return entries[i];
  }
  const next = roundRobinCursor.get(configId) ?? 0;
  const idx = next % entries.length;
  roundRobinCursor.set(configId, next + 1);
  console.log(`[cookie-pool] 轮询选用第 ${idx + 1}/${entries.length} 组（配置 #${configId}）`);
  return entries[idx];
}
