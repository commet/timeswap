import { defineConfig } from 'vitest/config';

// 화면 컴포넌트가 아니라 lib 아래의 순수 함수만 본다.
// 저장 형식과 학사일정 변환은 화면 없이도 틀릴 수 있고, 틀리면 조용히 틀린다.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./test/setup-timezone.ts'],
  },
});
