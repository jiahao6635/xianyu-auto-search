import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { createScraper, isProductSent, recordSentProduct } from '@/lib/xianyu-scraper';
import { sendWebhookNotification } from '@/lib/webhook';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();

    // 获取配置
    const { data: config, error } = await client
      .from('monitor_configs')
      .select('*')
      .eq('id', parseInt(id))
      .single();

    if (error || !config) {
      return NextResponse.json(
        { error: '监控配置不存在' },
        { status: 404 }
      );
    }

    // 检查是否配置了 Cookie
    if (!config.cookies) {
      return NextResponse.json({
        success: false,
        error: '未设置 Cookie，请先在配置中添加闲鱼登录 Cookie',
        hint: '在浏览器登录闲鱼后，按 F12 打开开发者工具，从 Network 请求中复制 Cookie',
      });
    }

    // 执行搜索
    const scraper = await createScraper(config.cookies || undefined);
    try {
      const products = await scraper.search({
        keyword: config.search_keyword,
        priceMin: config.price_min || undefined,
        priceMax: config.price_max || undefined,
        timeRange: config.time_range || undefined,
        sortType: config.sort_type || undefined,
        cookies: config.cookies || undefined,
      });

      console.log(`找到 ${products.length} 个商品`);

      // 如果没有找到商品，可能是 Cookie 过期
      if (products.length === 0) {
        return NextResponse.json({
          success: true,
          total: 0,
          newProducts: 0,
          products: [],
          warning: '未找到符合条件的商品，可能原因：\n1. Cookie 已过期，请重新获取\n2. 搜索条件过于严格\n3. 闲鱼页面结构变化',
        });
      }

      // 过滤已发送的商品
      const newProducts = [];
      for (const product of products) {
        const sent = await isProductSent(product.id, config.id);
        if (!sent) {
          newProducts.push(product);
        }
      }

      console.log(`发现 ${newProducts.length} 个新商品`);

      // 发送通知并记录
      if (newProducts.length > 0 && config.webhook_url) {
        await sendWebhookNotification(config.webhook_url, newProducts, {
          id: config.id,
          search_keyword: config.search_keyword,
        });

        // 记录已发送的商品
        for (const product of newProducts) {
          await recordSentProduct(product.id, config.id, product);
        }
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
    console.error('触发扫描失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '扫描失败' },
      { status: 500 }
    );
  }
}
