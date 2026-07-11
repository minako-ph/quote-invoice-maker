import { defineConfig } from 'vitest/config';

// apps-script 専用のテスト設定（pnpm -r test で確実に test/ 配下を拾う）。
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
