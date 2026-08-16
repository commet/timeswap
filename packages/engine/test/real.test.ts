import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromComcigan, type ComciganData } from '../src/adapters/comcigan.js';
import { recommend } from '../src/search.js';
import { applyChanges, totalHoles, validate } from '../src/timetable.js';

// 실제 고등학교(교사명은 소스에서 마스킹됨)의 컴시간 뷰어 JSON 픽스처.
// 학기 중 변경(isChanged) 반영본이라 현실의 지저분함(동시수업, 중간 공강)이 그대로 있다.
const raw = readFileSync(new URL('./fixtures/comcigan-demo.json', import.meta.url), 'utf8');
const data = JSON.parse(raw) as ComciganData;

describe('실데이터: 컴시간 뷰어 JSON 어댑터', () => {
  const { input, changedLessons, groupedLessons } = fromComcigan(data);

  it('규모 있는 실제 학교가 온전히 읽힌다', () => {
    const teachers = new Set(input.assignments.map((a) => a.teacher));
    const klasses = new Set(input.assignments.map((a) => a.klass));
    expect(input.assignments.length).toBeGreaterThan(800);
    expect(teachers.size).toBeGreaterThan(50);
    expect(klasses.size).toBeGreaterThan(30);
    console.log(
      `실데이터 규모: 수업 ${input.assignments.length}개, 교사 ${teachers.size}명, ` +
        `학급 ${klasses.size}개, 변경 반영 ${changedLessons}건, 동시수업 묶음 ${groupedLessons}건, ` +
        `중간 공강 ${totalHoles(input)}개`,
    );
  });

  it('어댑터 결과가 하드 불변식을 지킨다', () => {
    expect(validate(input)).toEqual([]);
  });

  it('실데이터 결강 탐색이 1초 안에 끝나고 후보가 나온다', () => {
    // 묶음 없는 수업을 가진 교사 다섯을 골라 결강을 걸어 본다
    const plain = input.assignments.filter((a) => !a.group);
    const picked = new Map<string, (typeof plain)[number]>();
    for (const a of plain) {
      if (!picked.has(a.teacher)) picked.set(a.teacher, a);
      if (picked.size >= 5) break;
    }
    const holesBefore = totalHoles(input);
    let candidateTotal = 0;
    for (const target of picked.values()) {
      const t0 = performance.now();
      const { candidates } = recommend(
        input,
        { teacher: target.teacher, slot: target.slot },
        { max: 30 },
      );
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(1000);
      candidateTotal += candidates.length;
      for (const cand of candidates) {
        const applied = applyChanges(input, cand.changes);
        expect(validate(applied)).toEqual([]);
        expect(totalHoles(applied)).toBeLessThanOrEqual(holesBefore);
      }
    }
    expect(candidateTotal).toBeGreaterThan(0);
    console.log(`실데이터 결강 5건의 후보 합계: ${candidateTotal}개`);
  });
});
