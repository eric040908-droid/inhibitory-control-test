import { defineConfig } from 'vitest/config';

// 테스트 파일이 test/expect/vi를 import 없이 쓰므로 globals를 켠다.
// 기본 환경은 node이며, 화면 테스트는 파일 맨 위 `// @vitest-environment jsdom`으로 전환한다.
export default defineConfig({
  test: { globals: true },
});
