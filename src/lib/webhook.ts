import { Product } from './xianyu-scraper';

interface MonitorConfig {
  id: number;
  search_keyword: string;
}

interface WebhookPayload {
  configId: number;
  keyword: string;
  count: number;
  timestamp: string;
  products: Array<{
    id: string;
    title: string;
    price: number;
    priceYuan: string;
    url: string;
    imageUrl: string;
  }>;
}

export async function sendWebhookNotification(
  webhookUrl: string,
  products: Product[],
  config: MonitorConfig
): Promise<void> {
  try {
    const payload: WebhookPayload = {
      configId: config.id,
      keyword: config.search_keyword,
      count: products.length,
      timestamp: new Date().toISOString(),
      products: products.map(p => ({
        id: p.id,
        title: p.title,
        price: p.price,
        priceYuan: (p.price / 100).toFixed(2),
        url: p.url,
        imageUrl: p.imageUrl,
      })),
    };

    // 发送到 Webhook
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook 调用失败: ${response.status} ${response.statusText}`);
    }

    console.log(`成功发送 ${products.length} 个商品通知到 ${webhookUrl}`);
  } catch (error) {
    console.error('发送 Webhook 通知失败:', error);
    throw error;
  }
}
