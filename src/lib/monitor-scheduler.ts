import cron, { ScheduledTask } from 'node-cron';
import { getMonitorBackendClient as getSupabaseClient } from '@/storage/database/supabase-client';
import { enqueueMonitorTask } from './monitor-queue';
import { CollectionPausedError, FilterNotAppliedError } from './collection-safety';
import {
  createScraper,
  Product,
  recordFetchedProducts,
} from './xianyu-scraper';
import { isCookieConfigured, resolveCookieForRun } from '@/lib/cookie-pool';
import { sendOutboxNotification } from './webhook';
import { DeliveryRejectedError, MonitorOutbox, monitorScope, OutboxPersistenceError } from './monitor-outbox';
import type { OutboxJob } from './monitor-outbox';
import { getCronDescription, isLegacyFrequency } from './monitor-frequency';

interface MonitorConfig {
  id: number;
  search_keyword: string;
  price_min: number | null;
  price_max: number | null;
  region_province: string | null;
  region_city: string | null;
  region_district: string | null;
  time_range: string | null;
  sort_type: string | null;
  cron_expression: string;
  webhook_url: string | null;
  cookies: string | null;
  is_active: boolean;
  browser_headless: boolean | null;
  browser_save_debug: boolean | null;
  browser_channel: string | null;
  browser_executable_path: string | null;
  browser_user_data_dir: string | null;
}

const scheduledTasks = new Map<number, ScheduledTask>();
const deliveryTasks = new Map<number, ScheduledTask>();
const locallyPaused = new Set<number>();

export async function readRunnableConfig(configId: number): Promise<MonitorConfig> {
  if (locallyPaused.has(configId)) throw new Error('采集已暂停，请人工处理后重新启用');
  const { data, error } = await getSupabaseClient().from('monitor_configs').select('*').eq('id', configId).single();
  if (error || !data) throw new Error('无法确认监控状态，本轮不采集');
  if (!data.is_active) throw new Error('监控已停用，跳过排队扫描');
  return data as MonitorConfig;
}

export async function pauseMonitor(configId: number): Promise<void> {
  locallyPaused.add(configId);
  stopMonitor(configId);
  const { error } = await getSupabaseClient().from('monitor_configs').update({ is_active: false }).eq('id', configId);
  if (error) throw new Error('本进程已暂停，但数据库暂停保存失败；重启前需手动停用该配置');
}

async function deliverJob(configId: number, scope: string, job: OutboxJob): Promise<void> {
  const current = await readRunnableConfig(configId);
  if (monitorScope(current) !== scope || !current.webhook_url) {
    throw new DeliveryRejectedError(false, '配置已变更，本事件未发送');
  }
  await sendOutboxNotification(current.webhook_url, job, current);
}

function buildBatchId(prefix: 'manual' | 'scheduler', configId: number): string {
  return `${prefix}-${configId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveBrowserChannel(channel: string | null): 'chrome' | 'msedge' | undefined {
  if (channel === 'chrome' || channel === 'msedge') {
    return channel;
  }
  return undefined;
}

export async function startAllMonitors() {
  const client = getSupabaseClient();
  const { data: configs, error } = await client
    .from('monitor_configs')
    .select('*')
    .eq('is_active', true);

  if (error) {
    console.error('获取监控配置失败:', error);
    return;
  }

  if (!configs) {
    return;
  }

  for (const config of configs) {
    startMonitor(config as MonitorConfig);
  }

  console.log(`已启动 ${configs.length} 个监控任务`);
}

export function startMonitor(config: MonitorConfig) {
  stopMonitor(config.id);
  locallyPaused.delete(config.id);

  if (!cron.validate(config.cron_expression)) {
    console.error(`无效的 cron 表达式: ${config.cron_expression}`);
    return;
  }

  if (isLegacyFrequency(config.cron_expression)) {
    console.warn(`配置 #${config.id} 使用旧版频率表达式：${getCronDescription(config.cron_expression)}。未自动迁移，请核对后在界面保存预期频率。`);
  }

  const task = cron.schedule(
    config.cron_expression,
    async () => {
      const label = `scheduler#${config.id}:${config.search_keyword}`;
      console.log(`[${new Date().toISOString()}] 监控任务入队 #${config.id}: ${config.search_keyword}`);
      try {
        await enqueueMonitorTask(label, () => executeMonitor(config), String(config.id));
      } catch (error) {
        console.warn(`[scheduler] 配置 #${config.id} 本轮未完成:`, error instanceof Error ? error.message : 'unknown');
      }
    },
    { timezone: 'Asia/Shanghai' },
  );

  scheduledTasks.set(config.id, task);
  const deliveryTask = cron.schedule('*/30 * * * * *', async () => {
    try {
      await enqueueMonitorTask(`delivery#${config.id}`, async () => {
        const current = await readRunnableConfig(config.id);
        if (!current.webhook_url) return;
        const outbox = new MonitorOutbox(getSupabaseClient());
        try {
          const scope = monitorScope(current);
          await outbox.drain(current.id, scope, job => deliverJob(current.id, scope, job));
        } catch (error) {
          if (error instanceof OutboxPersistenceError) await pauseMonitor(current.id);
          throw error;
        }
      }, String(config.id));
    } catch (error) {
      console.warn(`[delivery] 配置 #${config.id} 队列处理停止:`, error instanceof Error ? error.message : 'unknown');
    }
  }, { timezone: 'Asia/Shanghai' });
  deliveryTasks.set(config.id, deliveryTask);
  console.log(`监控任务 #${config.id} 已启动 (${config.cron_expression})`);
}

export function stopMonitor(configId: number) {
  deliveryTasks.get(configId)?.stop();
  deliveryTasks.delete(configId);
  const task = scheduledTasks.get(configId);
  if (!task) {
    return;
  }

  task.stop();
  scheduledTasks.delete(configId);
  console.log(`监控任务 #${configId} 已停止`);
}

export interface ScanResult {
  success: true;
  total: number;
  newProducts: number;
  products: Product[];
  baseline: boolean;
  delivered: number;
  scanSkipped?: boolean;
}

export async function executeMonitor(config: MonitorConfig, triggerSource: 'manual' | 'scheduler' = 'scheduler'): Promise<ScanResult> {
  let scanToken: string | null = null;
  let outbox: MonitorOutbox | undefined;
  try {
    config = await readRunnableConfig(config.id);
    outbox = new MonitorOutbox(getSupabaseClient());
    const scope = monitorScope(config);
    let delivered = config.webhook_url ? await outbox.drain(config.id, scope, job => deliverJob(config.id, scope, job)) : 0;
    scanToken = await outbox.beginScan(config.id);
    if (!scanToken) return { success: true, total: 0, newProducts: 0, products: [], baseline: false, delivered, scanSkipped: true };
    if (!isCookieConfigured(config.cookies) && !config.browser_user_data_dir) {
      throw new CollectionPausedError('初始化', '未配置授权登录会话');
    }

    const resolvedCookies = resolveCookieForRun(config.cookies, config.id);

    const browserOptions = {
      headless: config.browser_headless ?? undefined,
      saveDebugArtifacts: config.browser_save_debug ?? undefined,
      channel: resolveBrowserChannel(config.browser_channel),
      executablePath: config.browser_executable_path || undefined,
      userDataDir: config.browser_user_data_dir || undefined,
    };

    const scraper = await createScraper(resolvedCookies, browserOptions);

    try {
      const products = await scraper.search({
        keyword: config.search_keyword,
        priceMin: config.price_min ?? undefined,
        priceMax: config.price_max ?? undefined,
        regionProvince: config.region_province || undefined,
        regionCity: config.region_city || undefined,
        regionDistrict: config.region_district || undefined,
        timeRange: config.time_range || undefined,
        sortType: config.sort_type || undefined,
        cookies: resolvedCookies,
        browserOptions,
      });

      console.log(`找到 ${products.length} 个商品`);
      const current = await readRunnableConfig(config.id);
      if (monitorScope(current) !== scope) throw new Error('扫描中配置变更，丢弃旧条件结果，等待下一轮');

      const batchId = buildBatchId(triggerSource, config.id);
      await recordFetchedProducts(batchId, config.id, triggerSource, products);
      console.log(`[scheduler] 已写入 fetched_products: batchId=${batchId}, count=${products.length}`);

      const result = await outbox.ingest(config.id, scanToken, scope, products);
      scanToken = null;
      console.log(`[monitor] config=${config.id} baseline=${result.baseline} new=${result.products.length}`);
      if (config.webhook_url) delivered += await outbox.drain(config.id, scope, job => deliverJob(config.id, scope, job));
      return { success: true, total: products.length, newProducts: result.products.length,
        products: result.products, baseline: result.baseline, delivered };
    } finally {
      await scraper.close();
    }
  } catch (error) {
    if (scanToken && outbox) {
      try { await outbox.scanFailed(config.id, scanToken); }
      catch (persistenceError) { await pauseMonitor(config.id); throw persistenceError; }
    }
    if (error instanceof CollectionPausedError || error instanceof FilterNotAppliedError || error instanceof OutboxPersistenceError) await pauseMonitor(config.id);
    console.error(`监控任务 #${config.id} 执行失败:`, error);
    throw error;
  }
}

export async function triggerMonitor(configId: number): Promise<ScanResult> {
  const client = getSupabaseClient();
  const { data: config, error } = await client
    .from('monitor_configs')
    .select('*')
    .eq('id', configId)
    .single();

  if (error || !config) {
    throw new Error('监控配置不存在');
  }

  const label = `manual#${configId}:${config.search_keyword}`;
  return enqueueMonitorTask(label, () => executeMonitor(config as MonitorConfig, 'manual'), String(configId));
}

export function stopAllMonitors() {
  for (const task of deliveryTasks.values()) task.stop();
  deliveryTasks.clear();
  for (const [configId, task] of scheduledTasks) {
    task.stop();
    console.log(`监控任务 #${configId} 已停止`);
  }
  scheduledTasks.clear();
}
