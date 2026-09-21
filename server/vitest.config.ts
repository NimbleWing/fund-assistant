import { defineConfig } from 'vitest/config';

// 测试统一走内存/临时环境（见 src/test/setup.ts）；生产入口不经 vitest。
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
  },
});
