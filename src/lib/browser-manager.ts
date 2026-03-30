import { Browser, BrowserContext, BrowserContextOptions, chromium, LaunchOptions, Page } from 'playwright';

export interface BrowserRuntimeOptions {
  headless: boolean;
  channel?: 'chrome' | 'msedge';
  executablePath?: string;
  userDataDir?: string;
  saveDebugArtifacts: boolean;
  startMinimized: boolean;
  idleCloseMs: number;
}

interface BrowserLease {
  context: BrowserContext;
  release: () => Promise<void>;
}

function buildLaunchArgs(options: BrowserRuntimeOptions): string[] {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
  ];

  if (!options.headless && options.startMinimized) {
    args.push('--start-minimized');
    args.push('--window-position=-32000,-32000');
  }

  return args;
}

function buildLaunchOptions(options: BrowserRuntimeOptions): LaunchOptions {
  return {
    headless: options.headless,
    channel: options.channel,
    executablePath: options.executablePath,
    args: buildLaunchArgs(options),
  };
}

function buildContextOptions(): BrowserContextOptions {
  return {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-CN',
  };
}

export async function minimizePageWindow(page: Page) {
  try {
    const cdpSession = await page.context().newCDPSession(page);
    const { windowId } = await cdpSession.send('Browser.getWindowForTarget');
    await cdpSession.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'minimized' },
    });
    await cdpSession.detach().catch(() => undefined);
  } catch (error) {
    console.warn('[browser] 页面最小化失败，将继续使用启动参数兜底:', error);
  }
}

export async function acquireBrowserLease(
  options: BrowserRuntimeOptions,
): Promise<BrowserLease> {
  let browser: Browser | null = null;
  let context: BrowserContext;

  if (options.userDataDir) {
    console.log(
      `[browser] 创建持久化浏览器上下文: userDataDir=${options.userDataDir}, headless=${options.headless}, minimized=${options.startMinimized}`,
    );
    context = await chromium.launchPersistentContext(options.userDataDir, {
      ...buildLaunchOptions(options),
      ...buildContextOptions(),
    });
  } else {
    console.log(
      `[browser] 创建独立浏览器实例: headless=${options.headless}, channel=${options.channel || 'system'}, minimized=${options.startMinimized}`,
    );
    browser = await chromium.launch(buildLaunchOptions(options));
    context = await browser.newContext(buildContextOptions());
  }

  return {
    context,
    release: async () => {
      await context.close().catch(() => undefined);
      if (browser) {
        await browser.close().catch(() => undefined);
      }
      console.log('[browser] 本次任务浏览器已关闭');
    },
  };
}

export async function closeAllManagedBrowsers() {
  return;
}
