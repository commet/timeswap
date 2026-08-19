import { describe, expect, it } from 'vitest';
import {
  PRO_SHARE,
  SHARED_SUBJECT_MIN,
  fromNeis,
  gradeShapes,
  neisToTimetable,
  type NeisRow,
} from '../src/adapters/neis';
import type { TimetableInput } from '../src/types';

const cfg = { days: 1, periods: 6, dayNames: ['월'] };

type Assignments = TimetableInput['assignments'];

/**
 * 공통과목 학년. 학급 전부가 같은 과목을 듣고 교시만 돌려 쓴다.
 *
 * 앞선 픽스처는 `(학급*6 + 교시) % 과목수` 로 과목을 흩뿌려 놓고 그것을 공통과목이라
 * 불렀다. 그 학년에서는 한 과목을 학급 열 개 가운데 넷만 듣는다. 실제 1학년은
 * 학급 전부가 국어를 듣는다. 전국 217곳 실측에서 일반고 1학년 공통도 중앙값이
 * 0.91 이었다. 그 모양을 그대로 만든다.
 */
function commonGrade(g: number, klasses: number, subjects: number, proEvery = 0): Assignments {
  const out: Assignments = [];
  for (let k = 1; k <= klasses; k++) {
    for (let p = 0; p < 6; p++) {
      const s = (p + k) % subjects;
      out.push({
        teacher: `T${g}-${s}-${k}`,
        klass: `${g}-${k}`,
        subject: `공통${g}_${s}`,
        slot: p,
        ...(proEvery > 0 && s % proEvery === 0 ? { pro: true } : {}),
      });
    }
  }
  return out;
}

/**
 * 선택과목 학년. 학급마다 다른 강좌를 듣는다.
 *
 * `share` 는 그 가운데 학급 전부가 함께 듣는 교시 수다. 공통과목이 남아 있는
 * 실제 3학년의 모양이다. 나머지 교시는 학급마다 저만의 강좌다.
 */
function electiveGrade(g: number, klasses: number, share: number, proEvery = 0): Assignments {
  const out: Assignments = [];
  for (let k = 1; k <= klasses; k++) {
    for (let p = 0; p < 6; p++) {
      const shared = p < share;
      const subject = shared ? `공통${g}_${p}` : `선택${g}_${k}_${p}`;
      out.push({
        teacher: `T${g}-${k}-${p}`,
        klass: `${g}-${k}`,
        subject,
        slot: p,
        ...(proEvery > 0 && !shared && p % proEvery === 0 ? { pro: true } : {}),
      });
    }
  }
  return out;
}

describe('학년의 편성 모양', () => {
  it('학급 전부가 같은 과목을 들으면 공통도가 1이다', () => {
    const input: TimetableInput = { config: cfg, assignments: commonGrade(1, 10, 6) };
    const [shape] = gradeShapes(input);
    expect(shape?.klasses).toBe(10);
    expect(shape?.sharedRate).toBeCloseTo(1, 5);
    expect(shape?.elective).toBe(false);
  });

  it('학급마다 다른 강좌면 공통도가 바닥이고 선택과목 구간으로 본다', () => {
    // 여섯 교시 모두 학급 저만의 강좌. 공통도는 1/10 이다.
    const input: TimetableInput = { config: cfg, assignments: electiveGrade(3, 10, 0) };
    const [shape] = gradeShapes(input);
    expect(shape?.sharedRate).toBeCloseTo(0.1, 5);
    expect(shape?.elective).toBe(true);
  });

  it('공통과목이 절반 남은 학년은 기준을 넘지 못해 선택과목 구간으로 본다', () => {
    // 여섯 교시 가운데 셋이 공통. 실제 일반고 3학년 중앙값(0.39) 언저리다.
    const input: TimetableInput = { config: cfg, assignments: electiveGrade(3, 10, 3) };
    const [shape] = gradeShapes(input);
    expect(shape!.sharedRate).toBeLessThan(SHARED_SUBJECT_MIN);
    expect(shape?.elective).toBe(true);
  });

  it('학급 수가 달라도 같은 교육과정이면 같은 판정이 나온다', () => {
    // 옛 지표(과목 종수 / 학급 수)가 무너지던 자리다. 학급이 둘이면 값이 다섯 배로
    // 뛰어 같은 교육과정이 선택과목 구간으로 뒤집혔다.
    const small = gradeShapes({ config: cfg, assignments: commonGrade(1, 2, 6) })[0];
    const big = gradeShapes({ config: cfg, assignments: commonGrade(1, 14, 6) })[0];
    expect(small?.elective).toBe(false);
    expect(big?.elective).toBe(false);
    expect(small!.sharedRate).toBeCloseTo(big!.sharedRate, 5);
    // 같은 교육과정인데 옛 지표는 일곱 배가 벌어진다
    expect(small!.ratio / big!.ratio).toBeCloseTo(7, 0);
  });

  it('학년을 나눠 각각 판정한다', () => {
    const input: TimetableInput = {
      config: cfg,
      assignments: [...commonGrade(1, 10, 6), ...electiveGrade(3, 10, 0)],
    };
    const shapes = gradeShapes(input);
    expect(shapes.map((s) => s.grade)).toEqual([1, 3]);
    expect(shapes[0]?.elective).toBe(false);
    expect(shapes[1]?.elective).toBe(true);
  });

  it('학년을 못 읽는 학급 이름은 세지 않는다', () => {
    const input: TimetableInput = {
      config: cfg,
      assignments: [{ teacher: 'A', klass: '과학중점', subject: '국어', slot: 0 }],
    };
    expect(gradeShapes(input)).toEqual([]);
  });

  it('과목이 둘뿐인 얇은 자료로는 단정하지 않는다', () => {
    // 학급 하나만 받아 온 자료다. 공통도가 1이든 0이든 근거가 못 된다.
    const input: TimetableInput = {
      config: cfg,
      assignments: [
        { teacher: 'A', klass: '3-1', subject: '국어', slot: 0 },
        { teacher: 'B', klass: '3-2', subject: '수학', slot: 0 },
      ],
    };
    expect(gradeShapes(input)[0]?.elective).toBe(false);
  });

  it('담당 교사를 아직 안 채운 학급도 학년 학급 수에 센다', () => {
    // 표를 덜 채웠다고 그 학급이 사라지면 공통도가 실제보다 낮게 나온다.
    // 그러면 표를 덜 채웠다는 이유만으로 선택과목 구간이라는 안내가 나간다.
    const assignments = commonGrade(1, 4, 6).filter((a) => a.klass !== '1-4');
    const withBusy: TimetableInput = {
      config: cfg,
      assignments,
      klassBusy: { '1-4': [0, 1, 2, 3, 4, 5] },
    };
    const without: TimetableInput = { config: cfg, assignments };
    expect(gradeShapes(withBusy)[0]?.klasses).toBe(4);
    expect(gradeShapes(without)[0]?.klasses).toBe(3);
    expect(gradeShapes(withBusy)[0]?.elective).toBe(false);
  });

  it('기준값이 실측한 두 무리 사이에 있다', () => {
    // 전국 217곳 실측에서 일반고 1학년 중앙 0.91, 3학년 중앙 0.39 였다.
    expect(SHARED_SUBJECT_MIN).toBeGreaterThan(0.39);
    expect(SHARED_SUBJECT_MIN).toBeLessThan(0.91);
    // 표본을 절반으로 갈라 스무 번 다시 고르니 0.59 에서 0.70 사이가 나왔다.
    expect(SHARED_SUBJECT_MIN).toBeGreaterThanOrEqual(0.59);
    expect(SHARED_SUBJECT_MIN).toBeLessThanOrEqual(0.7);
  });
});

describe('과목이 많은 까닭을 가른다', () => {
  it('전문교과 표시가 없으면 선택과목으로 본다', () => {
    const input: TimetableInput = { config: cfg, assignments: electiveGrade(3, 10, 0) };
    const [shape] = gradeShapes(input);
    expect(shape?.kind).toBe('선택과목');
    expect(shape?.proSubjects).toBe(0);
  });

  it('전문교과가 많으면 전공실습으로 본다', () => {
    const input: TimetableInput = { config: cfg, assignments: electiveGrade(3, 10, 0, 2) };
    const [shape] = gradeShapes(input);
    expect(shape!.proSubjects / shape!.subjects).toBeGreaterThan(PRO_SHARE);
    expect(shape?.kind).toBe('전공실습');
  });

  it('공통과목만 도는 학년은 표시가 있어도 보통으로 둔다', () => {
    // 교체가 어렵다는 안내 자체가 안 나가는 자리다. 까닭을 물을 일도 없다.
    const input: TimetableInput = { config: cfg, assignments: commonGrade(1, 10, 6, 2) };
    const [shape] = gradeShapes(input);
    expect(shape?.elective).toBe(false);
    expect(shape?.kind).toBe('보통');
  });

  it('전문교과가 드문드문이면 선택과목으로 남는다', () => {
    // 일반고에 실습 과목 몇 개가 섞인 모양이다. 학교 전체 몫이 기준 아래다.
    const input: TimetableInput = { config: cfg, assignments: electiveGrade(3, 10, 5, 6) };
    const [shape] = gradeShapes(input);
    expect(shape!.proSubjects / shape!.subjects).toBeLessThan(PRO_SHARE);
    expect(shape?.kind).toBe('선택과목');
  });

  it('전문교과가 없는 1학년도 학교를 보고 전공실습으로 읽는다', () => {
    // 실측에서 특성화고 1학년의 전문교과 몫 중앙값은 0.00 이었다.
    // 그 학년만 떼어 보면 일반고와 구분되지 않는다. 학교 전체를 봐야 갈린다.
    const input: TimetableInput = {
      config: cfg,
      assignments: [
        ...electiveGrade(1, 10, 0),
        ...electiveGrade(2, 10, 0, 2),
        ...electiveGrade(3, 10, 0, 2),
      ],
    };
    const shapes = gradeShapes(input);
    expect(shapes[0]?.proSubjects).toBe(0);
    expect(shapes[0]?.kind).toBe('전공실습');
  });

  it('전문교과 기준이 전국 표본의 최저 오분류 구간에 있다', () => {
    // 217곳에서 일반계와 전문계를 정답으로 놓고 훑으니 0.15 가 오분류 6곳으로 최저였다.
    // 0.30 이상은 전문계 미탐이 14%로 뛴다.
    expect(PRO_SHARE).toBeGreaterThan(0);
    expect(PRO_SHARE).toBeLessThan(0.2);
  });
});

/**
 * 합성 자료가 아니라 나이스 행에서 출발하는 검사.
 *
 * 위의 검사들은 학급 이름을 `1-3` 으로 적는다. 그래서 학급 키에서 첫 숫자를 학년으로
 * 읽는 코드가 통과했다. 실제 나이스 학급 키는 학교 코드로 시작하는 구조화된 값이라
 * 첫 숫자가 학년이 아니다. 실제 학교 217곳을 넣어 보고서야 드러났고, 그때
 * `gradeShapes` 는 217곳 전부에서 빈 배열을 돌려주고 있었다.
 * 자료를 저장소에 둘 수 없으니 같은 모양의 행을 몇 줄 만들어 잠근다.
 */
describe('나이스 행에서 온 학급 키', () => {
  const row = (klass: string, ymd: string, perio: number, subject: string): NeisRow => {
    const [grade, num] = klass.split('-');
    return {
      SCHUL_NM: '학년읽기고등학교',
      ATPT_OFCDC_SC_CODE: 'B10',
      SD_SCHUL_CODE: '7010084',
      ALL_TI_YMD: ymd,
      GRADE: grade!,
      CLASS_NM: num!,
      PERIO: String(perio),
      ITRT_CNTNT: subject,
    } as NeisRow;
  };

  it('학급 키가 학교 코드로 시작해도 학년을 읽는다', () => {
    const rows: NeisRow[] = [];
    for (const ymd of ['20260601', '20260608']) {
      for (let k = 1; k <= 4; k++) {
        for (let p = 1; p <= 4; p++) {
          // 1학년은 학급 전부가 같은 과목, 3학년은 학급마다 다른 강좌
          rows.push(row(`1-${k}`, ymd, p, `공통${(p + k) % 4}`));
          rows.push(row(`3-${k}`, ymd, p, `선택${k}_${p}`));
        }
      }
    }
    const report = fromNeis(rows);
    // 학급 키에 학교 코드가 들어 있다. 여기서 첫 숫자를 캐면 7010084 다.
    expect(report.cells[0]!.klass).toContain('7010084');
    expect(Number(/\d+/.exec(report.cells[0]!.klass)![0])).toBeGreaterThan(12);

    const input = neisToTimetable(report, (_k, s) => `${s}샘`);
    const shapes = gradeShapes(input);
    expect(shapes.map((s) => s.grade)).toEqual([1, 3]);
    expect(shapes[0]?.klasses).toBe(4);
    expect(shapes[0]?.elective).toBe(false);
    expect(shapes[1]?.elective).toBe(true);
  });

  it('학년을 명시로 넘기지 않은 표는 학급 이름 앞머리로 되돌아간다', () => {
    // 사람이 적은 표를 그대로 쓰는 길을 막지 않는다
    const input: TimetableInput = { config: cfg, assignments: commonGrade(2, 5, 6) };
    expect(input.klassGrade).toBeUndefined();
    expect(gradeShapes(input).map((s) => s.grade)).toEqual([2]);
  });
});
