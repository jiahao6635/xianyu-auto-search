import { Product } from './xianyu-scraper';

interface MonitorConfig {
  id: number;
  search_keyword: string;
}

interface GenericWebhookPayload {
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
    publishTime: string | null;
    location: string | null;
  }>;
}

interface FeishuWebhookResponse {
  code?: number;
  msg?: string;
  StatusCode?: number;
  StatusMessage?: string;
}

const FEISHU_BATCH_SIZE = 6;

function isFeishuWebhook(webhookUrl: string): boolean {
  return webhookUrl.includes('open.feishu.cn/open-apis/bot/');
}

function formatPrice(price: number): string {
  return `¥${(price / 100).toFixed(2)}`;
}

function maskWebhookUrl(webhookUrl: string): string {
  return webhookUrl.replace(/(hook\/)[^/?#]+/, '$1***');
}

function escapeLarkMd(text: string): string {
  return text.replace(/[\\`*_{}\[\]()#+\-.!|>~]/g, '\\$&');
}

function formatPublishTime(product: Product): string {
  return product.publishTime || '未知';
}

function formatLocation(product: Product): string {
  return product.location || '未知';
}

function buildGenericPayload(products: Product[], config: MonitorConfig): GenericWebhookPayload {
  return {
    configId: config.id,
    keyword: config.search_keyword,
    count: products.length,
    timestamp: new Date().toISOString(),
    products: products.map(product => ({
      id: product.id,
      title: product.title,
      price: product.price,
      priceYuan: (product.price / 100).toFixed(2),
      url: product.url,
      imageUrl: product.imageUrl,
      publishTime: product.publishTime || null,
      location: product.location || null,
    })),
  };
}

function buildFeishuCardPayload(
  products: Product[],
  config: MonitorConfig,
  batchIndex: number,
  totalBatches: number,
) {
  const productBlocks = products.flatMap((product, index) => {
    const displayTitle = escapeLarkMd(product.title.slice(0, 60));
    const prefix = batchIndex * FEISHU_BATCH_SIZE + index + 1;

    return [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content:
            `**${prefix}. ${displayTitle}**\n` +
            `价格：${formatPrice(product.price)}\n` +
            `上架时间：${escapeLarkMd(formatPublishTime(product))}\n` +
            `卖家地区：${escapeLarkMd(formatLocation(product))}\n` +
            `[打开闲鱼商品](${product.url})`,
        },
      },
      {
        tag: 'hr',
      },
    ];
  });

  if (productBlocks.length > 0) {
    productBlocks.pop();
  }

  return {
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true,
        enable_forward: true,
      },
      header: {
        template: 'orange',
        title: {
          tag: 'plain_text',
          content: `闲鱼监控新商品 ${batchIndex + 1}/${totalBatches}`,
        },
      },
      elements: [
        {
          tag: 'div',
          fields: [
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**关键词**\n${escapeLarkMd(config.search_keyword)}`,
              },
            },
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**配置 ID**\n${config.id}`,
              },
            },
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**本批数量**\n${products.length}`,
              },
            },
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**发送时间**\n${new Date().toLocaleString('zh-CN')}`,
              },
            },
          ],
        },
        {
          tag: 'hr',
        },
        ...productBlocks,
      ],
    },
  };
}

function chunkProducts(products: Product[], size: number): Product[][] {
  const result: Product[][] = [];
  for (let index = 0; index < products.length; index += size) {
    result.push(products.slice(index, index + size));
  }
  return result;
}

function summarizeProducts(products: Product[]): string {
  return products
    .slice(0, 5)
    .map(
      product =>
        `${product.id}:${product.title.slice(0, 20)}:${formatPrice(product.price)}:${formatPublishTime(product)}`,
    )
    .join(' | ');
}

async function postWebhook(
  webhookUrl: string,
  payload: unknown,
  options?: { label?: string; checkFeishuBusinessCode?: boolean },
) {
  const label = options?.label || 'webhook';
  console.log(`[webhook] ${label} 请求体预览: ${JSON.stringify(payload).slice(0, 1000)}`);

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const rawBody = await response.text();
  console.log(`[webhook] ${label} HTTP 响应: status=${response.status} ${response.statusText}`);
  console.log(`[webhook] ${label} 响应体: ${rawBody || '<empty>'}`);

  if (!response.ok) {
    throw new Error(`${label} HTTP 失败: ${response.status} ${response.statusText}`);
  }

  if (options?.checkFeishuBusinessCode) {
    let feishuResult: FeishuWebhookResponse | null = null;
    try {
      feishuResult = rawBody ? (JSON.parse(rawBody) as FeishuWebhookResponse) : null;
    } catch {
      throw new Error(`${label} 返回了非 JSON 响应: ${rawBody}`);
    }

    const businessCode = feishuResult?.code ?? feishuResult?.StatusCode ?? 0;
    const businessMessage = feishuResult?.msg ?? feishuResult?.StatusMessage ?? 'unknown error';

    if (businessCode !== 0) {
      throw new Error(`${label} 业务失败: code=${businessCode}, msg=${businessMessage}`);
    }
  }
}

async function sendFeishuBatches(webhookUrl: string, products: Product[], config: MonitorConfig) {
  const batches = chunkProducts(products, FEISHU_BATCH_SIZE);
  console.log(
    `[webhook] 飞书卡片分批发送: total=${products.length}, batches=${batches.length}, batchSize=${FEISHU_BATCH_SIZE}`,
  );

  for (const [index, batch] of batches.entries()) {
    console.log(
      `[webhook] 飞书批次 ${index + 1}/${batches.length}: count=${batch.length}, summary=${summarizeProducts(batch)}`,
    );

    const payload = buildFeishuCardPayload(batch, config, index, batches.length);
    await postWebhook(webhookUrl, payload, {
      label: `feishu card batch ${index + 1}/${batches.length}`,
      checkFeishuBusinessCode: true,
    });
  }
}

export async function sendWebhookNotification(
  webhookUrl: string,
  products: Product[],
  config: MonitorConfig,
): Promise<void> {
  const feishu = isFeishuWebhook(webhookUrl);

  console.log(
    `[webhook] 准备发送通知: type=${feishu ? 'feishu-card' : 'generic'}, count=${products.length}, configId=${config.id}, url=${maskWebhookUrl(webhookUrl)}`,
  );
  console.log(`[webhook] 商品摘要: ${summarizeProducts(products)}`);

  try {
    if (feishu) {
      await sendFeishuBatches(webhookUrl, products, config);
    } else {
      await postWebhook(webhookUrl, buildGenericPayload(products, config), {
        label: 'generic webhook',
      });
    }

    console.log(`[webhook] 通知发送成功: count=${products.length}, configId=${config.id}`);
  } catch (error) {
    console.error('[webhook] 发送通知失败:', error);
    throw error;
  }
}
