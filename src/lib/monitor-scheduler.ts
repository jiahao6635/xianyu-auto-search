import cron, { ScheduledTask } from 'node-cron';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { createScraper, isProductSent, recordSentProduct, Product } from './xianyu-scraper';
import { sendWebhookNotification } from './webhook';

interface MonitorConfig {
  id: number;
  search_keyword: string;
  price_min: number | null;
  price_max: number | null;
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

// 启动所有活跃的监控任务
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

  if (!configs) return;

  for (const config of configs) {
    startMonitor(config as MonitorConfig);
  }

  console.log(`已启动 ${configs.length} 个监控任务`);
}

// 启动单个监控任务
export function startMonitor(config: MonitorConfig) {
  // 如果任务已存在，先停止
  stopMonitor(config.id);

  // 验证 cron 表达式
  if (!cron.validate(config.cron_expression)) {
    console.error(`无效的 cron 表达式: ${config.cron_expression}`);
    return;
  }

  // 创建定时任务
  const task = cron.schedule(config.cron_expression, async () => {
    console.log(`[${new Date().toISOString()}] 执行监控任务 #${config.id}: ${config.search_keyword}`);
    await executeMonitor(config);
  }, {
    timezone: 'Asia/Shanghai',
  });

  scheduledTasks.set(config.id, task);
  console.log(`监控任务 #${config.id} 已启动 (${config.cron_expression})`);
}

// 停止监控任务
export function stopMonitor(configId: number) {
  const task = scheduledTasks.get(configId);
  if (task) {
    task.stop();
    scheduledTasks.delete(configId);
    console.log(`监控任务 #${configId} 已停止`);
  }
}

// 执行监控任务
export async function executeMonitor(config: MonitorConfig): Promise<Product[]> {
  try {
    // 检查是否配置了 Cookie
    if (!config.cookies) {
      console.warn(`配置 #${config.id} 未设置 Cookie，可能无法正常获取数据`);
    }

    const scraper = await createScraper(config.cookies || undefined, {
      headless: config.browser_headless ?? undefined,
      saveDebugArtifacts: config.browser_save_debug ?? undefined,
      channel:
        config.browser_channel === 'chrome' || config.browser_channel === 'msedge'
          ? config.browser_channel
          : undefined,
      executablePath: config.browser_executable_path || undefined,
      userDataDir: config.browser_user_data_dir || undefined,
    });
    
    try {
      // 执行搜索
      const products = await scraper.search({
        keyword: config.search_keyword,
        priceMin: config.price_min || undefined,
        priceMax: config.price_max || undefined,
        timeRange: config.time_range || undefined,
        sortType: config.sort_type || undefined,
        cookies: config.cookies || undefined,
        browserOptions: {
          headless: config.browser_headless ?? undefined,
          saveDebugArtifacts: config.browser_save_debug ?? undefined,
          channel:
            config.browser_channel === 'chrome' || config.browser_channel === 'msedge'
              ? config.browser_channel
              : undefined,
          executablePath: config.browser_executable_path || undefined,
          userDataDir: config.browser_user_data_dir || undefined,
        },
      });

      console.log(`找到 ${products.length} 个商品`);

      // 过滤已发送的商品
      const newProducts: Product[] = [];
      for (const product of products) {
        const sent = await isProductSent(product.id, config.id);
        if (!sent) {
          newProducts.push(product);
        }
      }

      console.log(`发现 ${newProducts.length} 个新商品`);

      // 发送通知并记录
      if (newProducts.length > 0 && config.webhook_url) {
        await sendWebhookNotification(config.webhook_url, newProducts, config);

        // 记录已发送的商品
        for (const product of newProducts) {
          await recordSentProduct(product.id, config.id, product);
        }
      }

      return newProducts;
    } finally {
      await scraper.close();
    }
  } catch (error) {
    console.error(`监控任务 #${config.id} 执行失败:`, error);
    throw error;
  }
}

// 手动触发监控
export async function triggerMonitor(configId: number): Promise<Product[]> {
  const client = getSupabaseClient();
  const { data: config, error } = await client
    .from('monitor_configs')
    .select('*')
    .eq('id', configId)
    .single();

  if (error || !config) {
    throw new Error('监控配置不存在');
  }

  return executeMonitor(config as MonitorConfig);
}

// 停止所有监控任务
export function stopAllMonitors() {
  for (const [configId, task] of scheduledTasks) {
    task.stop();
    console.log(`监控任务 #${configId} 已停止`);
  }
  scheduledTasks.clear();
}
