import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromComcigan, type ComciganData } from '../src/adapters/comcigan.js';
import { recommend } from '../src/search.js';

// 계획 5.2의 성능 예산: 결강 1건 탐색 1초 안.
// 합성이 목표하던 표준 규모(학급 30, 교사 60)보다 큰 실제 학교(학급 41, 교사 80+)로 잰다.
const raw = readFileSync(new URL('./fixtures/comcigan-demo.json', import.meta.url), 'utf8');
const data = JSON.parse(raw) as ComciganData;

describe('성능: 실제 규모 학교', () => {
  it('결강 10건의 전수 탐색이 각각 1초 예산 안에 끝난다', () => {
    const { input } = fromComcigan(data);
    const plain = input.assignments.filter((a) => !a.group);
    const targets = new Map<string, (typeof plain)[number]>();
    for (const a of plain) {
      if (!targets.has(a.teacher)) targets.set(a.teacher, a);
      if (targets.size >= 10) break;
    }
    expect(targets.size).toBe(10);

    let total = 0;
    let candidateTotal = 0;
    for (const target of targets.values()) {
      const t0 = performance.now();
      const { candidates } = recommend(
        input,
        { teacher: target.teacher, slot: target.slot },
        { max: 100 },
      );
      const elapsed = performance.now() - t0;
      total += elapsed;
      candidateTotal += candidates.length;
      expect(elapsed).toBeLessThan(1000);
    }
    expect(candidateTotal).toBeGreaterThan(0);
    console.log(
      `실제 규모 결강 10건 탐색 합계 ${total.toFixed(1)}ms (평균 ${(total / 10).toFixed(1)}ms), 후보 합계 ${candidateTotal}개`,
    );
  });
});
