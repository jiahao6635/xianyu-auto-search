import { BrowserContext, BrowserContextOptions, chromium, LaunchOptions, Page } from 'playwright';

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

interface ManagedContextEntry {
  context: BrowserContext;
  refCount: number;
  idleTimer: NodeJS.Timeout | null;
  options: BrowserRuntimeOptions;
  keepAlivePage: Page | null;
}

const managedContexts = new Map<string, ManagedContextEntry>();

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

function buildContextKey(options: BrowserRuntimeOptions): string {
  return JSON.stringify({
    headless: options.headless,
    channel: options.channel || null,
    executablePath: options.executablePath || null,
    userDataDir: options.userDataDir || null,
    startMinimized: options.startMinimized,
  });
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

async function ensureKeepAlivePage(entry: ManagedContextEntry) {
  const currentPage = entry.keepAlivePage;
  if (currentPage && !currentPage.isClosed()) {
    if (!entry.options.headless && entry.options.startMinimized) {
      await minimizePageWindow(currentPage);
    }
    return;
  }

  const page = await entry.context.newPage();
  await page.goto('about:blank').catch(() => undefined);
  entry.keepAlivePage = page;

  if (!entry.options.headless && entry.options.startMinimized) {
    await minimizePageWindow(page);
  }
}

async function closeManagedContext(key: string) {
  const entry = managedContexts.get(key);
  if (!entry || entry.refCount > 0) {
    return;
  }

  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
  }

  managedContexts.delete(key);
  await entry.context.close().catch(() => undefined);
  console.log(`[browser] 已关闭空闲浏览器上下文: key=${key}`);
}

function scheduleContextClose(key: string, idleCloseMs: number) {
  const entry = managedContexts.get(key);
  if (!entry || entry.refCount > 0) {
    return;
  }

  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
  }

  entry.idleTimer = setTimeout(() => {
    void closeManagedContext(key);
  }, idleCloseMs);
}

async function createManagedContext(options: BrowserRuntimeOptions): Promise<ManagedContextEntry> {
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
      `[browser] 创建共享浏览器上下文: headless=${options.headless}, channel=${options.channel || 'system'}, minimized=${options.startMinimized}`,
    );
    const browser = await chromium.launch(buildLaunchOptions(options));
    context = await browser.newContext(buildContextOptions());
  }

  const entry: ManagedContextEntry = {
    context,
    refCount: 0,
    idleTimer: null,
    options,
    keepAlivePage: null,
  };

  await ensureKeepAlivePage(entry);
  return entry;
}

export async function acquireBrowserLease(
  options: BrowserRuntimeOptions,
): Promise<BrowserLease> {
  const key = buildContextKey(options);
  let entry = managedContexts.get(key);

  if (!entry) {
    entry = await createManagedContext(options);
    managedContexts.set(key, entry);
  } else {
    console.log(
      `[browser] 复用浏览器上下文: channel=${options.channel || 'system'}, headless=${options.headless}, activeRefs=${entry.refCount}`,
    );
    await ensureKeepAlivePage(entry);
  }

  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }

  entry.refCount += 1;

  return {
    context: entry.context,
    release: async () => {
      const current = managedContexts.get(key);
      if (!current) {
        return;
      }

      current.refCount = Math.max(0, current.refCount - 1);
      await ensureKeepAlivePage(current);
      scheduleContextClose(key, current.options.idleCloseMs);
    },
  };
}

export async function closeAllManagedBrowsers() {
  const entries = Array.from(managedContexts.values());
  managedContexts.clear();

  await Promise.all(
    entries.map(async entry => {
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
      }
      await entry.context.close().catch(() => undefined);
    }),
  );
}
