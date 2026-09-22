// 本地服务控制：经 native messaging 引导启动/重启（需先运行 server/install-native.bat 安装 host）。
// 依赖注入（send/check/wait）便于单测；默认实现走 Chrome native messaging + 心跳探测。
import { NATIVE_HOST } from './config.ts';
import { checkHealth, type HealthResult } from './health.ts';

export interface NativeResponse {
  ok?: boolean;
  pid?: number;
  killed?: boolean;
  error?: string;
}

export type SendNative = (host: string, msg: { cmd: string }) => Promise<NativeResponse>;

/** 默认实现：Chrome native messaging（一次性 sendNativeMessage，host 拉起服务后即退）。 */
const sendViaChrome: SendNative = (host, msg) =>
  new Promise<NativeResponse>((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(host, msg, (r: NativeResponse) => {
        const err = chrome.runtime.lastError?.message;
        resolve(r ?? { ok: false, error: err ?? 'native host 无应答' });
      });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

export interface StartResult {
  online: boolean;
  error?: string;
}

export interface CtlDeps {
  send?: SendNative;
  check?: () => Promise<HealthResult>;
  wait?: (ms: number) => Promise<void>;
}

/** 向 host 发指令并轮询确认上线（每秒一次，最多 10 次）。 */
async function runCmd(cmd: 'start' | 'restart', deps: CtlDeps): Promise<StartResult> {
  const send = deps.send ?? sendViaChrome;
  const check = deps.check ?? (() => checkHealth());
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const r = await send(NATIVE_HOST, { cmd });
  if (!r?.ok) return { online: false, error: r?.error ?? 'native host 无应答' };
  for (let i = 0; i < 10; i++) {
    await wait(1000);
    if ((await check()).online) return { online: true };
  }
  return { online: false, error: '服务未在 10 秒内上线' };
}

/** native 启动服务并轮询确认上线。 */
export function startServer(deps: CtlDeps = {}): Promise<StartResult> {
  return runCmd('start', deps);
}

/** native 重启服务（host 杀掉 17521 监听进程后重新拉起）并轮询确认上线。 */
export function restartServer(deps: CtlDeps = {}): Promise<StartResult> {
  return runCmd('restart', deps);
}
