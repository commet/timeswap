import { describe, expect, it } from 'vitest';
import { fromNeis, neisToTimetable, groupCandidate, type NeisRow } from '../src/adapters/neis';
import { recommend } from '../src/search';
import { validate } from '../src/timetable';
import { buildUnits } from '../src/units';

/** 3학년 1, 2, 3반이 2교시에 같은 과목을 듣는 3주치 자료 */
function rows(subject: string): NeisRow[] {
  const out: NeisRow[] = [];
  for (const date of ['20260601', '20260608', '20260615']) {
    for (const k of ['1', '2', '3']) {
      for (let p = 1; p <= 4; p++) {
        out.push({
          ALL_TI_YMD: date,
          GRADE: '3',
          CLASS_NM: k,
          PERIO: String(p),
          ITRT_CNTNT: p === 2 ? subject : `과목${k}${p}`,
        });
      }
    }
  }
  return out;
}

const report = fromNeis(rows('미적분'));

describe('나이스 자료에서 동시 수업 묶기', () => {
  it('한 교사가 같은 교시에 여러 학급을 맡으면 묶는다', () => {
    // 사람이 같은 시간에 두 곳에 있을 수 없으므로 이건 짐작이 아니다.
    const input = neisToTimetable(report, (k, s) => (s === '미적분' ? '김미적' : `T${k}${s}`));
    const grouped = input.assignments.filter((a) => a.subject === '미적분');
    expect(grouped.length).toBe(3);
    expect(new Set(grouped.map((a) => a.group)).size).toBe(1);
    expect(grouped[0]?.group).toBeDefined();
  });

  it('묶은 뒤에는 불변식 검사를 통과한다', () => {
    const input = neisToTimetable(report, (k, s) => (s === '미적분' ? '김미적' : `T${k}${s}`));
    expect(validate(input)).toEqual([]);
  });

  it('묶인 수업은 통째로만 움직인다', () => {
    const input = neisToTimetable(report, (k, s) => (s === '미적분' ? '김미적' : `T${k}${s}`));
    const slot = input.assignments.find((a) => a.subject === '미적분')?.slot ?? 0;
    const r = recommend(input, { teacher: '김미적', slot }, { max: 30 });
    for (const c of r.candidates) {
      const moved = c.changes.filter((ch) => ch.from.subject === '미적분');
      // 미적분이 움직인다면 세 학급이 모두 함께 움직여야 한다
      expect(moved.length === 0 || moved.length === 3).toBe(true);
    }
  });

  it('한 학급짜리 수업은 묶지 않는다', () => {
    const input = neisToTimetable(report, (k, s) => `T${k}${s}`);
    expect(input.assignments.every((a) => a.group === undefined)).toBe(true);
    expect(buildUnits(input).size).toBe(input.assignments.length);
  });
});

describe('묶이지 않은 같은 교시 같은 과목 알리기', () => {
  const input = neisToTimetable(report, (k, s) => (s === '미적분' ? `미적_${k}` : `T${k}${s}`));
  const mine = input.assignments.find((a) => a.subject === '미적분' && a.klass === '3-1');

  it('교사가 다르면 자료만으로 이동수업인지 가릴 수 없어 묶지 않는다', () => {
    // 같은 시간에 같은 과목을 듣는다는 사실만으로는 이동수업이라 단정할 수 없다.
    // 잘못 묶으면 멀쩡한 교체안이 사라지므로 도구는 묶지 않고 알리기만 한다.
    expect(input.assignments.filter((a) => a.subject === '미적분').every((a) => !a.group)).toBe(
      true,
    );
  });

  it('짝이 늘 같으면 이동수업 후보로 알린다', () => {
    const others = groupCandidate(input, mine!.slot, '미적분', '3-1');
    expect(others.map((a) => a.klass).sort()).toEqual(['3-2', '3-3']);
  });

  it('이미 묶인 수업은 알림에서 뺀다', () => {
    const marked = {
      ...input,
      assignments: input.assignments.map((a) =>
        a.subject === '미적분' ? { ...a, group: '이동:미적분' } : a,
      ),
    };
    expect(groupCandidate(marked, mine!.slot, '미적분', '3-1')).toEqual([]);
  });

  it('짝이 교시마다 달라지면 알리지 않는다', () => {
    // 1교시에는 1반과 2반이, 3교시에는 2반과 3반이 같은 과목을 듣는다.
    // 흔한 편성일 뿐 이동수업이 아니다. 이런 것까지 알리면 알림이 곧 무시당한다.
    const cfg = { days: 1, periods: 4, dayNames: ['월'] };
    const mixed = {
      config: cfg,
      assignments: [
        { teacher: 'A', klass: '1-1', subject: '국어', slot: 0 },
        { teacher: 'B', klass: '1-2', subject: '국어', slot: 0 },
        { teacher: 'B', klass: '1-2', subject: '국어', slot: 2 },
        { teacher: 'C', klass: '1-3', subject: '국어', slot: 2 },
      ],
    };
    expect(groupCandidate(mixed, 0, '국어', '1-1')).toEqual([]);
    expect(groupCandidate(mixed, 2, '국어', '1-2')).toEqual([]);
  });

  it('한 학급만 그 과목을 들으면 알리지 않는다', () => {
    const cfg = { days: 1, periods: 4, dayNames: ['월'] };
    const solo = {
      config: cfg,
      assignments: [{ teacher: 'A', klass: '1-1', subject: '국어', slot: 0 }],
    };
    expect(groupCandidate(solo, 0, '국어', '1-1')).toEqual([]);
  });

  it('손으로 묶어 주면 통째로만 움직인다', () => {
    const marked = {
      ...input,
      assignments: input.assignments.map((a) =>
        a.subject === '미적분' ? { ...a, group: '이동:미적분' } : a,
      ),
    };
    const r = recommend(marked, { teacher: '미적_3-1', slot: mine!.slot }, { max: 30 });
    for (const c of r.candidates) {
      const moved = c.changes.filter((ch) => ch.from.subject === '미적분');
      expect(moved.length === 0 || moved.length === 3).toBe(true);
    }
  });
});
