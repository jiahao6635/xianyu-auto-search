import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const port = process.env.PORT || '5000';
const tsxCliPath = resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

const child = spawn(process.execPath, [tsxCliPath, 'watch', 'src/server.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: port,
  },
  shell: false,
});

let isShuttingDown = false;

function killChildTree() {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      shell: false,
    });
    return;
  }

  child.kill('SIGTERM');
}

function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  killChildTree();

  setTimeout(() => {
    process.exit(signal === 'SIGINT' ? 130 : 0);
  }, 100);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) {
    shutdown(signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('Failed to start development server:', error);
  process.exit(1);
});
