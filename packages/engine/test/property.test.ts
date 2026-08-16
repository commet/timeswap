import { describe, expect, it } from 'vitest';
import { genSchool, mulberry32 } from '../src/synthetic.js';
import { recommend } from '../src/search.js';
import {
  applyChanges,
  buildIndexes,
  ksKey,
  totalHoles,
  tsKey,
  validate,
} from '../src/timetable.js';

// 속성: 어떤 무작위 학교, 어떤 결강에 대해서도
//   1) 합성 시간표 자체가 불변식을 지킨다
//   2) 모든 추천안은 적용 후에도 불변식을 지킨다 (하드 제약 보존)
//   3) 결강 교사는 해당 슬롯에서 사라진다
//   4) 이동이 없는 유형이면 학급의 해당 슬롯은 계속 채워져 있다
describe('속성: 추천안의 하드 제약 보존', () => {
  const seeds = Array.from({ length: 12 }, (_, i) => i + 1);

  it.each(seeds)('시드 %i 학교에서 모든 추천안이 안전하다', (seed) => {
    const school = genSchool({ classes: 12, seed });
    expect(validate(school)).toEqual([]);

    const rng = mulberry32(seed * 7919);
    for (let trial = 0; trial < 3; trial++) {
      const target =
        school.assignments[Math.floor(rng() * school.assignments.length)]!;
      const { candidates } = recommend(
        school,
        { teacher: target.teacher, slot: target.slot },
        { max: 50 },
      );
      const holesBefore = totalHoles(school);
      for (const cand of candidates) {
        const applied = applyChanges(school, cand.changes);
        expect(validate(applied)).toEqual([]);
        expect(totalHoles(applied)).toBeLessThanOrEqual(holesBefore);
        const idx = buildIndexes(applied);
        expect(idx.byTeacherSlot.get(tsKey(target.teacher, target.slot))).toBeUndefined();
        if (cand.type !== 'move') {
          expect(idx.byKlassSlot.get(ksKey(target.klass, target.slot))).toBeDefined();
        }
        expect(cand.trace.length).toBeGreaterThan(0);
      }
    }
  });
});
