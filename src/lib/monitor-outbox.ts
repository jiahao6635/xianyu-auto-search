import type { Product } from './xianyu-scraper';

export interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface OutboxJob {
  event_id: string;
  attempt_token: string;
  attempts: number;
  payload: { product: Product; first_seen_at: string; platform_publish_time: string | null };
}
export class OutboxPersistenceError extends Error {}
export class DeliveryUncertainError extends Error {}
export class DeliveryRejectedError extends Error {
  readonly retryable: boolean;
  constructor(retryable: boolean, message: string) {
    super(message);
    this.retryable = retryable;
  }
}

export class MonitorOutbox {
  private client: RpcClient;
  constructor(client: RpcClient) { this.client = client; }
  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.client.rpc(name, args);
    if (error) throw new OutboxPersistenceError(`持久状态操作失败: ${name}；本轮停止，不盲目重发`);
    return data;
  }
  async beginScan(configId: number): Promise<string | null> {
    return await this.call('monitor_begin_scan', { p_config_id: configId }) as string | null;
  }
  async ingest(configId: number, token: string, scope: string, products: Product[]): Promise<{ baseline: boolean; products: Product[] }> {
    return await this.call('monitor_ingest', { p_config_id: configId, p_token: token, p_scope: scope, p_products: products }) as { baseline: boolean; products: Product[] };
  }
  async scanFailed(configId: number, token: string): Promise<void> {
    await this.call('monitor_scan_failure', { p_config_id: configId, p_token: token });
  }
  async finish(job: OutboxJob, outcome: string, error: string | null = null): Promise<void> {
    await this.call('monitor_finish', { p_event_id: job.event_id, p_token: job.attempt_token, p_outcome: outcome, p_error: error });
  }
  async drain(configId: number, scope: string, send: (job: OutboxJob) => Promise<void>, limit = 10): Promise<number> {
    let delivered = 0;
    for (let count = 0; count < limit; count++) {
      const job = await this.call('monitor_claim', { p_config_id: configId, p_scope: scope }) as OutboxJob | null;
      if (!job) break;
      console.log(`[outbox] claimed event=${job.event_id} attempt=${job.attempts}`);
      // Claim is durable before any network operation. Lost claims become uncertain, never auto-retried.
      try {
        await send(job);
      } catch (error) {
        if (error instanceof DeliveryRejectedError) {
          await this.finish(job, error.retryable ? 'retry' : 'failed', error.retryable ? 'explicit_rate_limit' : 'explicit_rejection');
          console.warn(`[outbox] event=${job.event_id} outcome=${error.retryable ? 'retry' : 'failed'}`);
        } else {
          await this.finish(job, 'uncertain', 'response_or_network_outcome_unknown');
          console.warn(`[outbox] event=${job.event_id} outcome=uncertain requires_operator_review`);
        }
        break; // Respect a rejection/cooldown; let the next delivery tick handle remaining work.
      }
      // Completion and compatibility sent_products write are one database transaction.
      // If this call fails/losses its response, leave the durable sending claim for reconciliation.
      await this.finish(job, 'delivered');
      console.log(`[outbox] delivered event=${job.event_id}`);
      delivered++;
    }
    return delivered;
  }
}

export function monitorScope(config: {
  search_keyword: string; price_min: number | null; price_max: number | null;
  region_province: string | null; region_city: string | null; region_district: string | null;
  time_range: string | null; sort_type: string | null;
}): string {
  return JSON.stringify([config.search_keyword, config.price_min, config.price_max,
    config.region_province, config.region_city, config.region_district, config.time_range, config.sort_type]);
}
