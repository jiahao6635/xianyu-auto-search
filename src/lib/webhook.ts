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
    mobileUrl: string;
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
/** 飞书对 webhook 发卡片有频率限制，批次之间留出间隔可降低 11232 frequency limited */
const FEISHU_INTER_BATCH_DELAY_MS = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

function buildMobileUrl(product: Product): string {
  return `https://h5.m.goofish.com/item?id=${encodeURIComponent(product.id)}`;
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
      mobileUrl: buildMobileUrl(product),
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
    const mobileUrl = buildMobileUrl(product);

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
            `[手机打开](${mobileUrl}) | [网页打开](${product.url})`,
        },
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: '手机打开优先使用闲鱼移动详情页，若手机已安装闲鱼，通常会自动拉起 App。',
          },
        ],
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
          tag: 'note',
          elements: [
            {
              tag: 'plain_text',
              content:
                '说明：m.tb.cn 短链和闲鱼小程序口令属于客户端分享结果，无法仅凭商品 ID 稳定生成；当前采用手机可直接访问的闲鱼移动详情页链接。',
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
    const label = `feishu card batch ${index + 1}/${batches.length}`;
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await postWebhook(webhookUrl, payload, {
          label,
          checkFeishuBusinessCode: true,
        });
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isFreqLimited =
          message.includes('11232') ||
          message.includes('frequency limited') ||
          message.includes('Frequency limit');
        if (!isFreqLimited || attempt === maxAttempts) {
          throw error;
        }
        const waitMs = 1500 * attempt;
        console.warn(
          `[webhook] 飞书频率限制，${waitMs}ms 后重试第 ${attempt + 1}/${maxAttempts} 次：${label}`,
        );
        await sleep(waitMs);
      }
    }

    if (index < batches.length - 1) {
      await sleep(FEISHU_INTER_BATCH_DELAY_MS);
    }
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
