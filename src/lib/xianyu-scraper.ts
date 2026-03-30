import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BrowserContext, Cookie, ElementHandle, Page } from 'playwright';
import {
  acquireBrowserLease,
  BrowserRuntimeOptions,
  minimizePageWindow,
} from '@/lib/browser-manager';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface Product {
  id: string;
  title: string;
  price: number;
  url: string;
  imageUrl: string;
  publishTime?: string;
  location?: string;
}

export type { BrowserRuntimeOptions } from '@/lib/browser-manager';

export interface SearchConfig {
  keyword: string;
  priceMin?: number;
  priceMax?: number;
  timeRange?: string;
  sortType?: string;
  cookies?: string;
  browserOptions?: Partial<BrowserRuntimeOptions>;
}

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
}

interface BrowserLease {
  context: BrowserContext;
  release: () => Promise<void>;
}

export class XianyuScraper {
  private context: BrowserContext | null = null;
  private browserLease: BrowserLease | null = null;
  private runtimeOptions: BrowserRuntimeOptions = this.getRuntimeOptions();

  async init(cookies?: string, overrides?: Partial<BrowserRuntimeOptions>) {
    if (this.context) {
      return;
    }

    this.runtimeOptions = this.getRuntimeOptions(overrides);
    this.browserLease = await acquireBrowserLease(this.runtimeOptions);
    this.context = this.browserLease.context;

    if (cookies) {
      await this.setCookies(cookies);
    }
  }

  async close() {
    if (this.browserLease) {
      await this.browserLease.release().catch(() => undefined);
    }

    this.browserLease = null;
    this.context = null;
  }

  async search(config: SearchConfig): Promise<Product[]> {
    if (!this.context) {
      await this.init(config.cookies, config.browserOptions);
    }

    const page = await this.context!.newPage();

    if (!this.runtimeOptions.headless && this.runtimeOptions.startMinimized) {
      await minimizePageWindow(page);
    }

    try {
      console.log('[scraper] 访问闲鱼首页...');
      await page.goto('https://www.goofish.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(2000);

      const searchUrl = this.buildSearchUrl(config);
      console.log(`[scraper] 搜索 URL: ${searchUrl}`);

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);

      await this.applySearchFilters(page, config);

      const pageTitle = await page.title().catch(() => '');
      console.log(`[scraper] 当前页面标题: ${pageTitle}`);

      const loginButton = await page.getByText('登录').first().isVisible().catch(() => false);
      if (loginButton) {
        console.warn(
          '[scraper] 检测到登录按钮，Cookie 可能已过期，或当前浏览器上下文没有继承本机登录态',
        );
      }

      await this.saveDebugArtifacts(page, 'search');
      const products = await this.extractProducts(page);
      console.log(`[scraper] 最终提取到 ${products.length} 个商品`);
      return products;
    } catch (error) {
      console.error('[scraper] 搜索失败:', error);
      await this.saveDebugArtifacts(page, 'error');
      throw error;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private getRuntimeOptions(overrides?: Partial<BrowserRuntimeOptions>): BrowserRuntimeOptions {
    const channelValue = overrides?.channel ?? process.env.COZE_BROWSER_CHANNEL?.trim();
    const channel =
      channelValue === 'chrome' || channelValue === 'msedge' ? channelValue : undefined;

    return {
      headless: overrides?.headless ?? this.readBooleanEnv('COZE_BROWSER_HEADLESS', false),
      channel,
      executablePath:
        overrides?.executablePath ??
        (process.env.COZE_BROWSER_EXECUTABLE_PATH?.trim() || undefined),
      userDataDir:
        overrides?.userDataDir ?? (process.env.COZE_BROWSER_USER_DATA_DIR?.trim() || undefined),
      saveDebugArtifacts:
        overrides?.saveDebugArtifacts ?? this.readBooleanEnv('COZE_BROWSER_SAVE_DEBUG', true),
      startMinimized:
        overrides?.startMinimized ?? this.readBooleanEnv('COZE_BROWSER_START_MINIMIZED', true),
      idleCloseMs: overrides?.idleCloseMs ?? this.readNumberEnv('COZE_BROWSER_IDLE_CLOSE_MS', 900000),
    };
  }

  private readBooleanEnv(key: string, defaultValue: boolean): boolean {
    const raw = process.env[key];
    if (!raw) {
      return defaultValue;
    }

    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
  }

  private readNumberEnv(key: string, defaultValue: number): number {
    const raw = process.env[key];
    if (!raw) {
      return defaultValue;
    }

    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : defaultValue;
  }

  private async setCookies(cookieString: string) {
    if (!this.context) {
      return;
    }

    try {
      let cookies: Cookie[] = [];

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
            console.log(`[scraper] 解析 JSON 格式 Cookie，共 ${cookies.length} 个`);
          }
        } catch {
          console.log('[scraper] JSON Cookie 解析失败，改为尝试字符串格式');
        }
      }

      if (cookies.length === 0) {
        cookies = cookieString
          .split(';')
          .map(cookie => cookie.trim())
          .filter(Boolean)
          .map(cookie => {
            const [name, ...valueParts] = cookie.split('=');
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
        console.log(`[scraper] 解析字符串格式 Cookie，共 ${cookies.length} 个`);
      }

      await this.context.addCookies(cookies);
      console.log(`[scraper] 成功设置 ${cookies.length} 个 Cookie`);
    } catch (error) {
      console.error('[scraper] 设置 Cookie 失败:', error);
    }
  }

  private async saveDebugArtifacts(page: Page, prefix: string) {
    if (!this.runtimeOptions.saveDebugArtifacts) {
      return;
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const debugDir = resolve(process.cwd(), '.next', 'debug', 'xianyu');
      const screenshotPath = resolve(debugDir, `${timestamp}-${prefix}.png`);
      const htmlPath = resolve(debugDir, `${timestamp}-${prefix}.html`);

      await mkdir(debugDir, { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await writeFile(htmlPath, await page.content(), 'utf8');

      console.log(`[scraper] 调试截图已保存: ${screenshotPath}`);
      console.log(`[scraper] 调试 HTML 已保存: ${htmlPath}`);
    } catch (error) {
      console.error('[scraper] 保存调试产物失败:', error);
    }
  }

  private buildSearchUrl(config: SearchConfig): string {
    const params = new URLSearchParams();
    params.append('q', config.keyword);
    return `https://www.goofish.com/search?${params.toString()}`;
  }

  private async applySearchFilters(page: Page, config: SearchConfig) {
    await page
      .waitForSelector('.search-container--eigqxPi6', { timeout: 15000 })
      .catch(() => undefined);

    if (config.sortType === 'newest') {
      await this.selectDropdownOption(page, '新发布', this.mapTimeRangeLabel(config.timeRange));
    }

    if (config.sortType === 'price_asc') {
      await this.selectDropdownOption(page, '价格', '价格从低到高');
    } else if (config.sortType === 'price_desc') {
      await this.selectDropdownOption(page, '价格', '价格从高到低');
    }

    if (config.priceMin || config.priceMax) {
      await this.fillPriceRange(page, config.priceMin, config.priceMax);
    }

    await this.toggleCheckboxByLabel(page, '个人闲置');
    await page.waitForTimeout(2500);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
  }

  private mapTimeRangeLabel(timeRange?: string): string {
    const labels: Record<string, string> = {
      '1hour': '最新',
      '24hours': '1天内',
      '7days': '7天内',
    };
    return labels[timeRange || ''] || '最新';
  }

  private async selectDropdownOption(page: Page, title: string, option: string) {
    const dropdown = page
      .locator('.search-select-container--ANusUe9S')
      .filter({ hasText: title })
      .first();

    if ((await dropdown.count()) === 0) {
      console.warn(`[scraper] 未找到筛选下拉框: ${title}`);
      return;
    }

    await dropdown.click().catch(() => undefined);
    await page.waitForTimeout(300);

    const optionLocator = page
      .locator('.search-select-item--H_AJBURX')
      .filter({ hasText: option })
      .first();

    if ((await optionLocator.count()) === 0) {
      console.warn(`[scraper] 未找到筛选项: ${title} -> ${option}`);
      return;
    }

    await optionLocator.click().catch(() => undefined);
    console.log(`[scraper] 已应用筛选: ${title} -> ${option}`);
    await page.waitForTimeout(1200);
  }

  private async fillPriceRange(page: Page, priceMin?: number, priceMax?: number) {
    const inputs = page.locator('.search-price-input--p1NQEAuz');
    if ((await inputs.count()) < 2) {
      console.warn('[scraper] 未找到价格输入框');
      return;
    }

    if (priceMin) {
      await inputs.nth(0).fill(String(priceMin)).catch(() => undefined);
    }
    if (priceMax) {
      await inputs.nth(1).fill(String(priceMax)).catch(() => undefined);
    }

    const confirmButton = page.locator('.search-price-confirm-button--I2ThavjG').first();
    await confirmButton.click().catch(() => undefined);
    console.log(`[scraper] 已填写价格区间: ${priceMin ?? ''}-${priceMax ?? ''}`);
    await page.waitForTimeout(1500);
  }

  private async toggleCheckboxByLabel(page: Page, label: string) {
    const checkboxItem = page
      .locator('.search-checkbox-item-container--DsTIZUle')
      .filter({ hasText: label })
      .first();

    if ((await checkboxItem.count()) === 0) {
      console.warn(`[scraper] 未找到复选框: ${label}`);
      return;
    }

    await checkboxItem.click().catch(() => undefined);
    console.log(`[scraper] 已尝试勾选复选框: ${label}`);
    await page.waitForTimeout(1000);
  }

  private async extractProducts(page: Page): Promise<Product[]> {
    const products = new Map<string, Product>();
    const itemSelectors = [
      '.feeds-item-wrap--rGdH_KoF',
      '[class*="search-item"]',
      '[class*="SearchItem"]',
      '[class*="goods-item"]',
      '[class*="product-item"]',
      'a[href*="/item"]',
      'a[href*="item?id="]',
    ];

    let items: ElementHandle<SVGElement | HTMLElement>[] = [];
    for (const selector of itemSelectors) {
      items = await page.$$(selector).catch(() => []);
      if (items.length > 0) {
        console.log(`[scraper] 使用选择器 ${selector} 找到 ${items.length} 个候选节点`);
        break;
      }
    }

    for (const item of items) {
      const product = await this.extractProductInfo(item);
      if (product) {
        products.set(product.id, product);
      }
    }

    const pageLevelProducts = await this.extractProductsFromPage(page);
    console.log(`[scraper] 页面级链接扫描提取到 ${pageLevelProducts.length} 个候选商品`);

    for (const product of pageLevelProducts) {
      products.set(product.id, product);
    }

    return [...products.values()];
  }

  private async extractProductInfo(
    item: ElementHandle<SVGElement | HTMLElement>,
  ): Promise<Product | null> {
    try {
      const info = await item.evaluate(node => {
        const root = node as HTMLElement;
        const linkElement = root.matches('a[href]') ? root : root.querySelector('a[href]');
        const href = linkElement?.getAttribute('href') || '';
        const title =
          root.querySelector('[class*="main-title"]')?.textContent ||
          root.querySelector('[class*="title"]')?.textContent ||
          root.textContent ||
          '';
        const priceRoot =
          root.querySelector('[class*="row3-wrap-price"]') ||
          root.querySelector('[class*="price-wrap"]') ||
          root.querySelector('[class*="price"]');
        const priceText = priceRoot?.textContent || '';
        const publishTimeNode =
          root.querySelector('[class*="row2-wrap-service"] [title]') ||
          root.querySelector('[class*="row2-wrap-service"] span') ||
          root.querySelector('[class*="row2-wrap-cpv"] [title]');
        const publishTime =
          publishTimeNode?.getAttribute?.('title') || publishTimeNode?.textContent || '';
        const imageUrl = root.querySelector('img')?.getAttribute('src') || '';
        const location =
          root.querySelector('[class*="seller-text--"]')?.textContent ||
          root.querySelector('[class*="seller-left"]')?.textContent ||
          '';

        return {
          href,
          title: title.replace(/\s+/g, ' ').trim(),
          priceText: priceText.replace(/\s+/g, ' ').trim(),
          publishTime: publishTime.replace(/\s+/g, ' ').trim(),
          imageUrl,
          location: location.replace(/\s+/g, ' ').trim(),
        };
      });

      const url = this.normalizeUrl(info.href);
      const id = this.extractProductId(url);
      if (!id) {
        return null;
      }

      return {
        id,
        title: info.title.slice(0, 100),
        price: this.parsePrice(info.priceText),
        url: url || '',
        imageUrl: this.normalizeUrl(info.imageUrl) || '',
        publishTime: info.publishTime || undefined,
        location: info.location || undefined,
      };
    } catch (error) {
      console.error('[scraper] 提取商品信息异常:', error);
      return null;
    }
  }

  private async extractProductsFromPage(page: Page): Promise<Product[]> {
    const candidates = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll('.feeds-item-wrap--rGdH_KoF, a[href*="item?id="]'),
      )
        .map(node => {
          const root = node as HTMLElement;
          const href =
            root.getAttribute('href') || root.querySelector('a[href]')?.getAttribute('href') || '';
          const title =
            root.querySelector('[class*="main-title"]')?.textContent ||
            root.querySelector('[class*="title"]')?.textContent ||
            root.textContent ||
            '';
          const priceText =
            root.querySelector('[class*="row3-wrap-price"]')?.textContent ||
            root.querySelector('[class*="price-wrap"]')?.textContent ||
            root.querySelector('[class*="price"]')?.textContent ||
            '';
          const publishTimeNode =
            root.querySelector('[class*="row2-wrap-service"] [title]') ||
            root.querySelector('[class*="row2-wrap-service"] span') ||
            root.querySelector('[class*="row2-wrap-cpv"] [title]');
          const publishTime =
            publishTimeNode?.getAttribute?.('title') || publishTimeNode?.textContent || '';
          const imageUrl = root.querySelector('img')?.getAttribute('src') || '';
          const location =
            root.querySelector('[class*="seller-text--"]')?.textContent ||
            root.querySelector('[class*="seller-left"]')?.textContent ||
            '';

          return {
            href,
            title: title.replace(/\s+/g, ' ').trim(),
            priceText: priceText.replace(/\s+/g, ' ').trim(),
            publishTime: publishTime.replace(/\s+/g, ' ').trim(),
            imageUrl,
            location: location.replace(/\s+/g, ' ').trim(),
          };
        })
        .filter(item => item.href);
    });

    const products = new Map<string, Product>();
    for (const candidate of candidates) {
      const url = this.normalizeUrl(candidate.href);
      const id = this.extractProductId(url);
      if (!id) {
        continue;
      }

      products.set(id, {
        id,
        title: candidate.title.slice(0, 100) || `商品 ${id}`,
        price: this.parsePrice(candidate.priceText),
        url: url || '',
        imageUrl: this.normalizeUrl(candidate.imageUrl) || '',
        publishTime: candidate.publishTime || undefined,
        location: candidate.location || undefined,
      });
    }

    return [...products.values()];
  }

  private normalizeUrl(rawUrl: string | null | undefined): string | null {
    if (!rawUrl) {
      return null;
    }

    if (rawUrl.startsWith('//')) {
      return `https:${rawUrl}`;
    }

    if (rawUrl.startsWith('/')) {
      return `https://www.goofish.com${rawUrl}`;
    }

    return rawUrl;
  }

  private extractProductId(url: string | null): string | null {
    if (!url) {
      return null;
    }

    const patterns = [
      /[?&](?:itemId|itemid|id)=([A-Za-z0-9_-]{6,})/i,
      /\/item\/([A-Za-z0-9_-]{6,})/i,
      /\/detail\/([A-Za-z0-9_-]{6,})/i,
      /\/([0-9]{6,})(?:\?|$|\/)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    return null;
  }

  private parsePrice(priceText: string): number {
    const normalizedText = priceText.replace(/\s+/g, '');
    const match = normalizedText.match(/[\d,.]+/);
    if (!match) {
      return 0;
    }

    let price = parseFloat(match[0].replace(/,/g, ''));
    if (Number.isNaN(price)) {
      return 0;
    }

    if (normalizedText.includes('万')) {
      price *= 10000;
    }

    return Math.round(price * 100);
  }
}

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

export async function recordSentProduct(
  productId: string,
  configId: number,
  product: Product,
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

export async function recordFetchedProducts(
  batchId: string,
  configId: number,
  triggerSource: 'manual' | 'scheduler',
  products: Product[],
): Promise<void> {
  if (products.length === 0) {
    return;
  }

  const client = getSupabaseClient();
  await client.from('fetched_products').insert(
    products.map(product => ({
      batch_id: batchId,
      config_id: configId,
      trigger_source: triggerSource,
      product_id: product.id,
      title: product.title,
      price: product.price,
      url: product.url,
      image_url: product.imageUrl,
      publish_time: product.publishTime || null,
      location: product.location || null,
    })),
  );
}

export async function createScraper(
  cookies?: string,
  browserOptions?: Partial<BrowserRuntimeOptions>,
): Promise<XianyuScraper> {
  const scraper = new XianyuScraper();
  await scraper.init(cookies, browserOptions);
  return scraper;
}
