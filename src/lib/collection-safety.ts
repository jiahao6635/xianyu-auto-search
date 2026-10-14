export class CollectionPausedError extends Error {
  readonly stage: string;
  readonly reason: string;
  constructor(stage: string, reason: string) {
    super(`采集暂停：${stage} / ${reason}。请人工处理后重新启用监控。`);
    this.stage = stage;
    this.reason = reason;
  }
}

export class FilterNotAppliedError extends Error {}

export function refusalReason(status: number, url: string): string | undefined {
  const hostname = new URL(url).hostname;
  if ((hostname === 'goofish.com' || hostname.endsWith('.goofish.com')) && [401, 403, 429].includes(status)) {
    return `HTTP ${status}`;
  }
  return undefined;
}
