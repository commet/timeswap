import { describe, expect, it } from 'vitest';
import { coverCandidates, recommend, validate } from '@timeswap/engine';
import { sampleSchool } from '../lib/app';

/**
 * 예시 학교는 이 도구를 처음 보는 분이 가장 먼저 만나는 자료다.
 * 그 자료에서 볼 수 없는 기능은 없는 기능과 같다.
 */
describe('예시 학교', () => {
  const input = sampleSchool().input;

  it('시간표가 성립한다', () => {
    expect(validate(input)).toEqual([]);
  });

  it('이동수업 묶음이 하나 들어 있다', () => {
    const groups = new Set(input.assignments.filter((a) => a.group).map((a) => a.group));
    expect(groups.size).toBe(1);
    const members = input.assignments.filter((a) => a.group);
    expect(members.length).toBeGreaterThanOrEqual(2);
    // 같은 교시에 서로 다른 학급이 모여 있어야 이동수업이다
    expect(new Set(members.map((a) => a.slot)).size).toBe(1);
    expect(new Set(members.map((a) => a.klass)).size).toBe(members.length);
  });

  it('묶음 수업을 고르면 보강 후보를 볼 수 있다', () => {
    // 교체가 안 되는 자리에서 무엇을 해 주는지가 이 도구의 절반이다.
    // 예시 학교에 그런 자리가 없으면 그 절반을 아무도 보지 못한다.
    const g = input.assignments.find((a) => a.group)!;
    const { candidates } = recommend(input, { teacher: g.teacher, slot: g.slot }, { max: 12 });
    const scarce = candidates.length < 3;
    expect(scarce).toBe(true);
    const covers = coverCandidates(input, g.slot, g.subject, 8, g.teacher);
    expect(covers.length).toBeGreaterThan(0);
  });

  it('묶음이 아닌 수업에서는 교체안이 넉넉하다', () => {
    // 묶음을 심었다고 도구 전체가 막히면 안 된다
    const a = input.assignments.find((x) => !x.group)!;
    const { candidates } = recommend(input, { teacher: a.teacher, slot: a.slot }, { max: 12 });
    expect(candidates.length).toBeGreaterThan(0);
  });
});
