import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { createScraper, isProductSent, recordFetchedProducts, recordSentProduct } from '@/lib/xianyu-scraper';
import { sendWebhookNotification } from '@/lib/webhook';

function summarizeProducts(
  products: Array<{ id: string; title: string; price: number }>,
  limit = 10,
): string {
  const summary = products
    .slice(0, limit)
    .map(product => `${product.id}:${product.title.slice(0, 20)}:¥${(product.price / 100).toFixed(2)}`)
    .join(' | ');

  return summary || '<none>';
}

function buildBatchId(prefix: 'manual' | 'scheduler', configId: number): string {
  return `${prefix}-${configId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();

    const { data: config, error } = await client
      .from('monitor_configs')
      .select('*')
      .eq('id', parseInt(id, 10))
      .single();

    if (error || !config) {
      return NextResponse.json({ error: '监控配置不存在' }, { status: 404 });
    }

    console.log(
      `[trigger] 开始执行监控: configId=${config.id}, keyword=${config.search_keyword}, webhook=${config.webhook_url ? 'configured' : 'missing'}`,
    );

    if (!config.cookies) {
      return NextResponse.json({
        success: false,
        error: '未配置 Cookie，请先在配置中填写闲鱼登录 Cookie',
        hint: '在浏览器登录闲鱼后，打开开发者工具，从 Network 请求中复制 Cookie',
      });
    }

    const browserOptions = {
      headless: config.browser_headless ?? undefined,
      saveDebugArtifacts: config.browser_save_debug ?? undefined,
      channel:
        config.browser_channel === 'chrome' || config.browser_channel === 'msedge'
          ? config.browser_channel
          : undefined,
      executablePath: config.browser_executable_path || undefined,
      userDataDir: config.browser_user_data_dir || undefined,
    };

    const scraper = await createScraper(config.cookies || undefined, browserOptions);

    try {
      const products = await scraper.search({
        keyword: config.search_keyword,
        priceMin: config.price_min || undefined,
        priceMax: config.price_max || undefined,
        timeRange: config.time_range || undefined,
        sortType: config.sort_type || undefined,
        cookies: config.cookies || undefined,
        browserOptions,
      });

      console.log(`[trigger] 抓取完成: total=${products.length}`);
      console.log(`[trigger] 抓取结果摘要: ${summarizeProducts(products, 5)}`);
      const batchId = buildBatchId('manual', config.id);
      await recordFetchedProducts(batchId, config.id, 'manual', products);
      console.log(`[trigger] 已写入 fetched_products: batchId=${batchId}, count=${products.length}`);

      if (products.length === 0) {
        return NextResponse.json({
          success: true,
          total: 0,
          newProducts: 0,
          products: [],
          warning:
            '未找到符合条件的商品，可能原因：\n1. Cookie 已过期\n2. 搜索条件过严\n3. 页面结构变化或筛选未生效',
        });
      }

      const newProducts = [];
      const sentProducts = [];

      for (const product of products) {
        const sent = await isProductSent(product.id, config.id);
        if (sent) {
          sentProducts.push(product);
        } else {
          newProducts.push(product);
        }
      }

      console.log(
        `[trigger] 去重完成: new=${newProducts.length}, existing=${sentProducts.length}, existingSummary=${summarizeProducts(sentProducts, 5)}`,
      );
      console.log(`[trigger] 新商品摘要: ${summarizeProducts(newProducts, 10)}`);

      if (newProducts.length > 0 && config.webhook_url) {
        console.log(`[trigger] 准备发送 webhook: configId=${config.id}, count=${newProducts.length}`);
        await sendWebhookNotification(config.webhook_url, newProducts, {
          id: config.id,
          search_keyword: config.search_keyword,
        });

        for (const product of newProducts) {
          await recordSentProduct(product.id, config.id, product);
        }
        console.log(`[trigger] 已写入 sent_products: count=${newProducts.length}`);
      } else if (newProducts.length > 0) {
        console.warn('[trigger] 有新商品但未配置 webhook，跳过通知');
      } else {
        console.log('[trigger] 没有新商品，跳过 webhook 和入库');
      }

      return NextResponse.json({
        success: true,
        total: products.length,
        newProducts: newProducts.length,
        products: newProducts,
      });
    } finally {
      await scraper.close();
    }
  } catch (error) {
    console.error('[trigger] 执行失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '扫描失败' },
      { status: 500 },
    );
  }
}
