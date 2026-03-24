import { chromium, Browser, Page, BrowserContext, Cookie } from 'playwright';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface Product {
  id: string;
  title: string;
  price: number; // 单位：分
  url: string;
  imageUrl: string;
  publishTime?: string;
  location?: string;
}

export interface SearchConfig {
  keyword: string;
  priceMin?: number;
  priceMax?: number;
  timeRange?: string; // "1hour", "24hours", "7days"
  sortType?: string; // "newest", "price_asc", "price_desc"
  cookies?: string; // Cookie 字符串或 JSON 格式
}

// JSON 格式的 Cookie 导出结构（浏览器插件格式）
interface CookieExport {
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
  }>;
  headers?: Record<string, string>;
}

export class XianyuScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async init(cookies?: string) {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    // 使用桌面版 User-Agent，更稳定
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'zh-CN',
    });

    // 设置 Cookie
    if (cookies && this.context) {
      await this.setCookies(cookies);
    }
  }

  /**
   * 解析并设置 Cookie（支持多种格式）
   */
  private async setCookies(cookieString: string) {
    if (!this.context) return;

    try {
      let cookies: Cookie[] = [];

      // 尝试解析为 JSON 格式（浏览器插件导出格式）
      if (cookieString.trim().startsWith('{') || cookieString.trim().startsWith('[')) {
        try {
          const jsonExport: CookieExport = JSON.parse(cookieString);
          
          if (jsonExport.cookies && Array.isArray(jsonExport.cookies)) {
            cookies = jsonExport.cookies.map(cookie => ({
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain || '.goofish.com',
              path: cookie.path || '/',
              expires: cookie.expires || -1,
              httpOnly: cookie.httpOnly || false,
              secure: cookie.secure !== false,
              sameSite: (cookie.sameSite as 'Strict' | 'Lax' | 'None') || 'None',
            }));
            console.log(`解析 JSON 格式 Cookie，共 ${cookies.length} 个`);
          }
        } catch {
          console.log('JSON 解析失败，尝试字符串格式');
        }
      }

      // 如果 JSON 解析失败或不是 JSON 格式，尝试字符串格式
      if (cookies.length === 0) {
        cookies = cookieString.split(';').map(cookie => {
          const [name, ...valueParts] = cookie.trim().split('=');
          return {
            name: name.trim(),
            value: valueParts.join('=').trim(),
            domain: '.goofish.com',
            path: '/',
            expires: -1,
            httpOnly: false,
            secure: true,
            sameSite: 'None' as const,
          };
        });
        console.log(`解析字符串格式 Cookie，共 ${cookies.length} 个`);
      }

      await this.context.addCookies(cookies);
      console.log(`成功设置 ${cookies.length} 个 Cookie`);
    } catch (error) {
      console.error('设置 Cookie 失败:', error);
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
    }
  }

  async search(config: SearchConfig): Promise<Product[]> {
    if (!this.context) {
      await this.init(config.cookies);
    }

    const page = await this.context!.newPage();
    
    try {
      // 先访问首页，确保 Cookie 生效
      console.log('访问闲鱼首页...');
      await page.goto('https://www.goofish.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      // 构建搜索 URL
      const searchUrl = this.buildSearchUrl(config);
      console.log('搜索 URL:', searchUrl);

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // 等待页面加载
      await page.waitForTimeout(3000);

      // 检查是否需要登录
      const loginButton = await page.$('text=登录');
      if (loginButton) {
        console.warn('检测到登录按钮，Cookie 可能已过期');
      }

      // 截图调试
      const screenshot = await page.screenshot({ fullPage: false });
      console.log(`页面截图大小: ${screenshot.length} bytes`);

      // 提取商品信息
      const products = await this.extractProducts(page, config);

      return products;
    } catch (error) {
      console.error('搜索失败:', error);
      // 失败时截图保存
      try {
        const errorScreenshot = await page.screenshot({ fullPage: false });
        console.log(`错误截图大小: ${errorScreenshot.length} bytes`);
      } catch {}
      throw error;
    } finally {
      await page.close();
    }
  }

  private buildSearchUrl(config: SearchConfig): string {
    const params = new URLSearchParams();
    params.append('q', config.keyword);
    
    // 价格过滤
    if (config.priceMin) {
      params.append('priceStart', String(config.priceMin));
    }
    if (config.priceMax) {
      params.append('priceEnd', String(config.priceMax));
    }

    // 排序方式
    if (config.sortType === 'newest') {
      params.append('sort', '_ctime');
    } else if (config.sortType === 'price_asc') {
      params.append('sort', 'price');
    } else if (config.sortType === 'price_desc') {
      params.append('sort', 'price_reverse');
    }

    // 闲鱼搜索 URL
    return `https://www.goofish.com/search?${params.toString()}`;
  }

  private async extractProducts(page: Page, config: SearchConfig): Promise<Product[]> {
    const products: Product[] = [];

    // 多种选择器尝试
    const itemSelectors = [
      // 新版页面结构
      '[class*="ItemCard"]',
      '[class*="itemCard"]', 
      '[class*="item-card"]',
      '[class*="Item--"]',
      // 搜索结果
      '[class*="search-item"]',
      '[class*="SearchItem"]',
      // 通用商品卡片
      '[class*="goods-item"]',
      '[class*="product-item"]',
      // 链接形式
      'a[href*="/item"]',
      'a[href*="itemId"]',
    ];

    let items: any[] = [];
    for (const selector of itemSelectors) {
      try {
        items = await page.$$(selector);
        if (items.length > 0) {
          console.log(`使用选择器 ${selector} 找到 ${items.length} 个商品`);
          break;
        }
      } catch (error) {
        console.log(`选择器 ${selector} 失败:`, error);
      }
    }

    if (items.length === 0) {
      console.log('未找到商品，尝试获取页面内容');
      const content = await page.content();
      console.log(`页面内容长度: ${content.length}`);
      
      // 检查是否有验证码或其他拦截
      if (content.includes('验证码') || content.includes('安全验证')) {
        console.warn('检测到验证码拦截');
      }
      
      return [];
    }

    for (const item of items) {
      try {
        const product = await this.extractProductInfo(item);
        if (product && this.matchFilter(product, config)) {
          products.push(product);
        }
      } catch (error) {
        console.error('提取商品信息失败:', error);
      }
    }

    return products;
  }

  private async extractProductInfo(item: any): Promise<Product | null> {
    try {
      // 提取链接和 ID
      const link = await item.getAttribute('href');
      if (!link) {
        // 尝试从子元素获取链接
        const linkElement = await item.$('a');
        if (linkElement) {
          const childLink = await linkElement.getAttribute('href');
          if (childLink) {
            const idMatch = childLink.match(/itemId=(\d+)|\/item\/(\d+)|id=(\d+)/);
            const id = idMatch ? (idMatch[1] || idMatch[2] || idMatch[3]) : null;
            if (id) {
              const title = await item.textContent() || '';
              const priceElement = await item.$('[class*="price"], [class*="Price"]');
              const priceText = priceElement ? await priceElement.textContent() : '0';
              const price = this.parsePrice(priceText);
              
              return {
                id,
                title: title.trim().slice(0, 100),
                price,
                url: childLink.startsWith('http') ? childLink : `https://www.goofish.com${childLink}`,
                imageUrl: '',
              };
            }
          }
        }
        return null;
      }

      // 从链接中提取商品 ID
      const idMatch = link.match(/itemId=(\d+)|\/item\/(\d+)|id=(\d+)/);
      const id = idMatch ? (idMatch[1] || idMatch[2] || idMatch[3]) : null;
      if (!id) return null;

      // 提取标题
      const titleElement = await item.$('[class*="title"], [class*="Title"], [class*="name"], h3, h4');
      const title = titleElement ? await titleElement.textContent() : await item.textContent() || '';

      // 提取价格
      const priceElement = await item.$('[class*="price"], [class*="Price"], [class*="Price--"]');
      const priceText = priceElement ? await priceElement.textContent() : '0';
      const price = this.parsePrice(priceText);

      // 提取图片
      const imgElement = await item.$('img');
      const imageUrl = imgElement ? await imgElement.getAttribute('src') : '';

      // 构建完整 URL
      const url = link.startsWith('http') ? link : `https://www.goofish.com${link}`;

      console.log(`提取商品: ID=${id}, 标题=${title?.slice(0, 20)}..., 价格=${price/100}元`);

      return {
        id,
        title: title?.trim() || '',
        price,
        url,
        imageUrl: imageUrl || '',
      };
    } catch (error) {
      console.error('提取商品信息异常:', error);
      return null;
    }
  }

  private parsePrice(priceText: string): number {
    // 移除货币符号和逗号，提取数字
    const match = priceText.match(/[\d,.]+/);
    if (!match) return 0;
    
    const price = parseFloat(match[0].replace(/,/g, ''));
    return Math.round(price * 100); // 转换为分
  }

  private matchFilter(product: Product, config: SearchConfig): boolean {
    // 价格过滤（单位：分）
    if (config.priceMin && product.price < config.priceMin * 100) {
      return false;
    }
    if (config.priceMax && product.price > config.priceMax * 100) {
      return false;
    }

    return true;
  }
}

// 检查商品是否已发送
export async function isProductSent(productId: string, configId: number): Promise<boolean> {
  const client = getSupabaseClient();
  const { data } = await client
    .from('sent_products')
    .select('id')
    .eq('product_id', productId)
    .eq('config_id', configId)
    .limit(1);
  
  return (data?.length || 0) > 0;
}

// 记录已发送的商品
export async function recordSentProduct(
  productId: string,
  configId: number,
  product: Product
): Promise<void> {
  const client = getSupabaseClient();
  await client.from('sent_products').insert({
    product_id: productId,
    config_id: configId,
    title: product.title,
    price: product.price,
    url: product.url,
    image_url: product.imageUrl,
  });
}

// 创建带 Cookie 的爬虫实例
export async function createScraper(cookies?: string): Promise<XianyuScraper> {
  const scraper = new XianyuScraper();
  await scraper.init(cookies);
  return scraper;
}
