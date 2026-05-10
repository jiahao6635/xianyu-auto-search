import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BrowserContext, Cookie, ElementHandle, Page } from 'playwright';
import { acquireBrowserLease, BrowserRuntimeOptions } from '@/lib/browser-manager';
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
  regionProvince?: string;
  regionCity?: string;
  regionDistrict?: string;
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

    try {
      const searchUrl = this.buildSearchUrl(config);
      console.log(`[scraper] 直接访问搜索页: ${searchUrl}`);

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(3000);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);

      await this.applySearchFilters(page, config);

      const pageTitle = await page.title().catch(() => '');
      console.log(`[scraper] 当前页面标题: ${pageTitle}`);

      const loginButtonVisible = await page.getByText('登录').first().isVisible().catch(() => false);
      if (loginButtonVisible) {
        console.warn('[scraper] 检测到登录按钮，Cookie 可能已过期，或当前浏览器上下文没有继承登录态');
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
      idleCloseMs:
        overrides?.idleCloseMs ?? this.readNumberEnv('COZE_BROWSER_IDLE_CLOSE_MS', 900000),
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

    await this.applyRegionFilter(page, config.regionProvince, config.regionCity, config.regionDistrict);

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

  private async applyRegionFilter(
    page: Page,
    province?: string,
    city?: string,
    district?: string,
  ) {
    if (!province && !city && !district) {
      return;
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(
        `[scraper] 准备应用区域筛选 (${attempt}/${maxAttempts}): province=${province || '-'}, city=${city || '-'}, district=${district || '-'}`,
      );

      const ok = await this.applyRegionFilterAttempt(page, attempt, province, city, district);
      if (ok) {
        console.log('[scraper] 已确认区域筛选');
        await page.waitForTimeout(1200);
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
        return;
      }

      if (attempt < maxAttempts) {
        console.warn(`[scraper] 区域筛选未成功，准备第 ${attempt + 1} 次重试（先关闭弹层）`);
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(500 + attempt * 400);
      }
    }

    console.warn('[scraper] 区域筛选在多次尝试后仍失败');
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  }

  /** 单次打开弹层、选省市区县、点「查看…宝贝」；失败时由上层重试 */
  private async applyRegionFilterAttempt(
    page: Page,
    attemptNo: number,
    province?: string,
    city?: string,
    district?: string,
  ): Promise<boolean> {
    const openers = [
      page.locator('.areaTextContainer--IQ5moIFF').first(),
      page.locator('span.areaText--mQJFfu1p').filter({ hasText: '区域' }).first(),
      page.locator('text=区域').first(),
    ];

    let opened = false;
    const useForceOpener = attemptNo >= 2;
    for (const opener of openers) {
      if ((await opener.count()) === 0) {
        continue;
      }

      try {
        await opener.scrollIntoViewIfNeeded().catch(() => undefined);
        await opener.click({ timeout: 5000, force: useForceOpener });
        opened = true;
        break;
      } catch {
        continue;
      }
    }

    if (!opened) {
      console.warn('[scraper] 未找到区域筛选入口');
      return false;
    }

    await page.getByText('选地区').waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined);
    await page
      .locator('[class*="areaWrap"]')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 })
      .catch(() => undefined);

    const districtTrimmed = district?.trim();

    if (province && !(await this.clickRegionOption(page, province, '省份'))) {
      return false;
    }

    if (city) {
      if (!(await this.clickRegionOption(page, city, '城市'))) {
        return false;
      }
      if (!districtTrimmed && !(await this.clickRegionOption(page, `全${city}`, '区县(全市)'))) {
        return false;
      }
    }

    if (districtTrimmed && !(await this.clickRegionOption(page, districtTrimmed, '区县'))) {
      return false;
    }

    return this.clickRegionConfirmButton(page);
  }

  /**
   * 地区弹层底部「查看999+件宝贝」：
   * - 文案含「+」；可点击层常在父级，仅用 Playwright 点子节点会「成功」但不关弹层。
   * - 不能用含「确定|完成」的无作用域 role 匹配，易误点页面其它按钮却返回成功。
   */
  private async clickRegionConfirmButton(page: Page): Promise<boolean> {
    const viewGoods = /查看\d+\+?\s*件宝贝|查看\d+\s*件宝贝/;

    const sheet = page.locator('[class*="areaWrap"]').first();
    await sheet.waitFor({ state: 'visible', timeout: 12000 }).catch(() => undefined);
    const hadSheet = await sheet.isVisible().catch(() => false);

    const sheetClosedAfterClick = async (): Promise<boolean> => {
      if (!hadSheet) return true;
      try {
        await sheet.waitFor({ state: 'hidden', timeout: 4500 });
        return true;
      } catch {
        const still = await sheet.isVisible().catch(() => false);
        return !still;
      }
    };

    const tryClickViaDom = (): Promise<boolean> =>
      page
        .evaluate(() => {
          const compact = (s: string) => s.replace(/\s+/g, '').trim();
          const matches = (raw: string) => {
            const t = compact(raw);
            return /^查看\d+\+?件宝贝$/.test(t) || /^查看\d+件宝贝$/.test(t);
          };

          const cand: HTMLElement[] = [];
          for (const n of document.querySelectorAll('button, a, [role="button"], div, span')) {
            const el = n as HTMLElement;
            const text = (el.innerText || el.textContent || '').trim();
            if (!text || text.length > 64) continue;
            if (!matches(text)) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 48 || r.height < 8) continue;
            if (r.bottom < -20 || r.top > window.innerHeight + 120) continue;
            cand.push(el);
          }

          if (cand.length === 0) return false;

          cand.sort((a, b) => {
            const la = compact(a.innerText || a.textContent || '').length;
            const lb = compact(b.innerText || b.textContent || '').length;
            if (la !== lb) return la - lb;
            return b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom;
          });

          const pick = cand[0];
          const clickable =
            (pick.closest('button, [role="button"], a[href]') as HTMLElement | null) || pick;
          clickable.scrollIntoView({ block: 'center', inline: 'nearest' });
          clickable.click();
          return true;
        })
        .catch(() => false);

    const tryClickLocator = async (
      root: ReturnType<Page['locator']>,
      opts?: { force?: boolean },
    ): Promise<boolean> => {
      const count = await root.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const el = root.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        try {
          await el.scrollIntoViewIfNeeded().catch(() => undefined);
          await el.click({ timeout: 5000, force: opts?.force });
          return true;
        } catch {
          continue;
        }
      }
      return false;
    };

    for (let attempt = 0; attempt < 8; attempt++) {
      if ((await tryClickViaDom()) && (await sheetClosedAfterClick())) {
        return true;
      }

      await page.getByText(viewGoods, { exact: false }).first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => undefined);

      if ((await tryClickLocator(page.getByRole('button', { name: viewGoods }))) && (await sheetClosedAfterClick())) {
        return true;
      }
      if ((await tryClickLocator(page.locator('button').filter({ hasText: viewGoods }))) && (await sheetClosedAfterClick())) {
        return true;
      }
      if ((await tryClickLocator(page.locator('[role="button"]').filter({ hasText: viewGoods }))) && (await sheetClosedAfterClick())) {
        return true;
      }
      if ((await tryClickLocator(page.locator('a').filter({ hasText: viewGoods }))) && (await sheetClosedAfterClick())) {
        return true;
      }

      const textHits = page.getByText(viewGoods);
      const n = await textHits.count().catch(() => 0);
      for (let i = n - 1; i >= 0; i--) {
        const el = textHits.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        try {
          await el.scrollIntoViewIfNeeded().catch(() => undefined);
          await el.click({ timeout: 5000 });
          if (await sheetClosedAfterClick()) return true;
        } catch {
          continue;
        }
      }

      const forceLoc = page.locator('button, [role="button"], a').filter({ hasText: viewGoods }).last();
      if ((await tryClickLocator(forceLoc, { force: true })) && (await sheetClosedAfterClick())) {
        return true;
      }
      const forceText = page.getByText(viewGoods).last();
      if ((await tryClickLocator(forceText, { force: true })) && (await sheetClosedAfterClick())) {
        return true;
      }

      await page.waitForTimeout(400);
    }

    return false;
  }

  /** 在地区弹层内点击选项；多轮重试，避免列未渲染完就点 */
  private async clickRegionOption(page: Page, label: string, level: string): Promise<boolean> {
    const exactRegex = new RegExp(`^${this.escapeRegExp(label)}$`);
    const maxRounds = 5;

    for (let round = 0; round < maxRounds; round++) {
      const modal = page.locator('[class*="areaWrap"]').first();
      const modalVisible = await modal.isVisible().catch(() => false);

      if (modalVisible) {
        const provRows = modal.locator('[class*="provItem"]').filter({ hasText: exactRegex });
        const provCount = await provRows.count();
        for (let i = 0; i < provCount; i++) {
          const item = provRows.nth(i);
          if (!(await item.isVisible().catch(() => false))) continue;
          try {
            await item.scrollIntoViewIfNeeded().catch(() => undefined);
            await item.click({ timeout: 3500 });
            console.log(`[scraper] 已选择${level}: ${label}`);
            await page.waitForTimeout(400);
            return true;
          } catch {
            continue;
          }
        }

        const byExact = modal.getByText(label, { exact: true });
        const nExact = await byExact.count();
        for (let i = 0; i < nExact; i++) {
          const item = byExact.nth(i);
          if (!(await item.isVisible().catch(() => false))) continue;
          try {
            await item.scrollIntoViewIfNeeded().catch(() => undefined);
            await item.click({ timeout: 3500 });
            console.log(`[scraper] 已选择${level}: ${label}`);
            await page.waitForTimeout(400);
            return true;
          } catch {
            continue;
          }
        }
      }

      const candidates = [
        page.locator('div').filter({ hasText: exactRegex }),
        page.locator('span').filter({ hasText: exactRegex }),
        page.getByText(label, { exact: true }),
      ];

      for (const candidate of candidates) {
        const count = await candidate.count().catch(() => 0);
        for (let index = 0; index < count; index += 1) {
          const item = candidate.nth(index);
          const visible = await item.isVisible().catch(() => false);
          if (!visible) continue;

          try {
            await item.scrollIntoViewIfNeeded().catch(() => undefined);
            await item.click({ timeout: 3500 });
            console.log(`[scraper] 已选择${level}: ${label}`);
            await page.waitForTimeout(400);
            return true;
          } catch {
            continue;
          }
        }
      }

      await page.waitForTimeout(180 + round * 100);
    }

    console.warn(`[scraper] 未找到${level}选项: ${label}`);
    return false;
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

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
