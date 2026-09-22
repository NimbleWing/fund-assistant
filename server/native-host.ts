// Native messaging 引导 host：接收扩展消息，detached 启动本地服务后即退出。
// 协议：4 字节小端长度前缀 + JSON（Chrome native messaging 标准）。
// 指令：start（拉起服务）/ restart（杀掉 17521 监听进程后重新拉起，仅此两个指令）。
// 安装：install-native.ps1 生成 com.fund.assistant.json 并写 HKCU 注册表（见 DESIGN.md §6）。
import { execSync, spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** 读一条 native message（stdin 关闭/出错返回 null）。 */
function readMessage(): Promise<unknown> {
  return new Promise((resolve) => {
    let len: number | null = null;
    let buf = Buffer.alloc(0);
    process.stdin.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (len === null) {
        if (buf.length < 4) return;
        len = buf.readUInt32LE(0);
        buf = buf.subarray(4);
      }
      if (buf.length >= len) {
        try {
          resolve(JSON.parse(buf.subarray(0, len).toString('utf8')));
        } catch {
          resolve(null);
        }
        return;
      }
    });
    process.stdin.on('end', () => resolve(null));
    process.stdin.on('error', () => resolve(null));
  });
}

function sendMessage(obj: unknown): void {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

/** 查 17521 端口监听进程 PID（Windows netstat）；无监听或查询失败返回 null。 */
function findServerPid(): number | null {
  let out: string;
  try {
    out = execSync('netstat -ano -p tcp', { encoding: 'utf8', windowsHide: true });
  } catch {
    return null;
  }
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length >= 5 && cols[1]?.endsWith(':17521') && cols[3] === 'LISTENING') {
      const pid = Number(cols[4]);
      if (pid > 0) return pid;
    }
  }
  return null;
}

/** detached 拉起服务（独立于本 host 与扩展连接存活）；stdio 重定向到 server.log（隐藏窗口无控制台，日志落盘可查）。 */
function spawnServer(): number | undefined {
  const logFd = openSync(path.join(ROOT, 'server.log'), 'a');
  const child = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'src', 'server.ts')], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: ROOT,
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

const msg = (await readMessage()) as { cmd?: unknown } | null;
if (msg?.cmd === 'start') {
  sendMessage({ ok: true, pid: spawnServer() });
} else if (msg?.cmd === 'restart') {
  // 只杀本服务端口（17521）的监听进程；杀完轮询确认端口释放（≤2s）再拉起，避免新进程 bind 冲突
  const old = findServerPid();
  if (old !== null) {
    try {
      execSync(`taskkill /F /PID ${old}`, { windowsHide: true });
    } catch {
      // 进程已退出则忽略
    }
    for (let i = 0; i < 20 && findServerPid() !== null; i++) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 100);
    }
  }
  sendMessage({ ok: true, pid: spawnServer(), killed: old !== null });
} else {
  sendMessage({ ok: false, error: 'unknown cmd' });
}
process.exit(0);
