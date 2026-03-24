import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { startAllMonitors, stopAllMonitors } from './lib/monitor-scheduler';

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  // 启动所有监控任务
  console.log('正在启动监控任务调度器...');
  await startAllMonitors();
  console.log('监控任务调度器启动完成');

  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });

  server.once('error', err => {
    console.error(err);
    stopAllMonitors();
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );
  });

  // 优雅关闭
  process.on('SIGTERM', () => {
    console.log('收到 SIGTERM 信号，正在关闭服务...');
    stopAllMonitors();
    server.close(() => {
      console.log('服务已关闭');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('收到 SIGINT 信号，正在关闭服务...');
    stopAllMonitors();
    server.close(() => {
      console.log('服务已关闭');
      process.exit(0);
    });
  });
});
