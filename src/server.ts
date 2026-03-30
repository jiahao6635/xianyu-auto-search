import { createServer } from 'http';
import next from 'next';
import { closeAllManagedBrowsers } from './lib/browser-manager';
import { startAllMonitors, stopAllMonitors } from './lib/monitor-scheduler';

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function shutdown(server: ReturnType<typeof createServer>, signal: string, exitCode = 0) {
  console.log(`[server] 收到 ${signal}，正在关闭服务...`);
  stopAllMonitors();

  server.close(() => {
    void closeAllManagedBrowsers().finally(() => {
      console.log('[server] 服务已关闭');
      process.exit(exitCode);
    });
  });
}

app.prepare().then(async () => {
  console.log('[server] 正在启动监控任务调度器...');
  await startAllMonitors();
  console.log('[server] 监控任务调度器启动完成');

  const server = createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (error) {
      console.error('[server] 处理请求失败:', req.url, error);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });

  server.once('error', error => {
    console.error('[server] 服务异常:', error);
    void closeAllManagedBrowsers().finally(() => {
      process.exit(1);
    });
  });

  server.listen(port, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );
  });

  process.on('SIGTERM', () => {
    void shutdown(server, 'SIGTERM');
  });

  process.on('SIGINT', () => {
    void shutdown(server, 'SIGINT');
  });
});
