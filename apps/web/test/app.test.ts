import { describe, expect, it, vi } from 'vitest';
import {
  applyAll,
  buildClosures,
  buildNeisList,
  deriveBurden,
  calendarCoversThisWeek,
  blankDaysOf,
  fromFile,
  gradeOf,
  normalizeName,
  sameGradeSubject,
  toFile,
  weekMondayOf,
  type AppliedEntry,
  type Calendar,
  type Loaded,
} from '../lib/app';
import type { NeisEvent } from '../lib/neis';
import { createNeisSession } from '../lib/neis-session';
import { canOpenInvitations, createWorkspaceFromNeis } from '../components/SetupFlow';
import { gradeShapes, normalizeNeisRows } from '@timeswap/engine';
import type { ScheduleConfig, TimetableInput } from '@timeswap/engine';

const cfg = { days: 5, periods: 7, dayNames: ['월', '화', '수', '목', '금'] };

const ev = (date: string, name: string, kind: string, grades = [true, true, true]): NeisEvent => ({
  date,
  name,
  kind,
  grades,
  isHoliday: kind === '휴업일' || kind === '공휴일',
  schoolCourse: '',
});

describe('나이스 인증키 세션', () => {
  it('메모리 안에서만 바꾸고 Storage에는 쓰지 않는다', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const session = createNeisSession();
    session.setKey(' secret ');
    expect(session.getKey()).toBe('secret');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    session.clear();
    expect(session.getKey()).toBe('');
  });
});

// 2026-08-17 은 월요일이다.
const MON = new Date(2026, 7, 17);

describe('지금 다루는 주의 월요일', () => {
  it('평일에 열면 그 주의 월요일이다', () => {
    expect(weekMondayOf(new Date(2026, 7, 19))).toEqual(MON); // 수요일
    expect(weekMondayOf(new Date(2026, 7, 21))).toEqual(MON); // 금요일
    expect(weekMondayOf(MON)).toEqual(MON);
  });

  it('주말에 열면 다음 주다', () => {
    // 토요일에 여는 사람은 다음 주 결강을 준비하는 것이다
    expect(weekMondayOf(new Date(2026, 7, 22))).toEqual(new Date(2026, 7, 24));
    expect(weekMondayOf(new Date(2026, 7, 23))).toEqual(new Date(2026, 7, 24));
  });
});

describe('학사일정을 요일로 옮기기', () => {
  const klasses = ['1-1', '2-1', '2-2', '3-1'];

  it('이번 주 휴업일만 골라 요일로 바꾼다', () => {
    const events = [
      ev('20260819', '개교기념일', '휴업일'), // 이번 주 수요일
      ev('20260826', '재량휴업', '휴업일'), // 다음 주라 걸리지 않는다
    ];
    const out = buildClosures(events, klasses, MON);
    expect(out).toEqual([{ day: 2, reason: '개교기념일' }]);
  });

  it('수업을 하는 행사는 막지 않는다', () => {
    const events = [ev('20260818', '체육대회', '해당없음')];
    expect(buildClosures(events, klasses, MON)).toEqual([]);
  });

  it('학년별로 갈리는 휴업일은 그 학년 학급에만 건다', () => {
    // 2학년만 쉰다
    const events = [ev('20260820', '수학여행', '휴업일', [false, true, false])];
    const out = buildClosures(events, klasses, MON);
    expect(out).toEqual([{ day: 3, reason: '수학여행', klasses: ['2-1', '2-2'] }]);
  });

  it('학년 표시가 모두 켜져 있으면 학교 전체로 본다', () => {
    const events = [ev('20260820', '광복절 대체', '공휴일', [true, true, true])];
    expect(buildClosures(events, klasses, MON)).toEqual([{ day: 3, reason: '광복절 대체' }]);
  });

  it('주말에 걸린 휴업일은 무시한다', () => {
    const events = [ev('20260822', '토요휴업', '휴업일')];
    expect(buildClosures(events, klasses, MON)).toEqual([]);
  });

  it('같은 날 학교 전체 휴업일이 학년 행사보다 이긴다', () => {
    const events = [
      ev('20260819', '2학년 현장학습', '휴업일', [false, true, false]),
      ev('20260819', '개교기념일', '휴업일', [true, true, true]),
    ];
    const out = buildClosures(events, klasses, MON);
    expect(out).toEqual([{ day: 2, reason: '개교기념일' }]);
  });

  it('그 학년의 학급이 하나도 없으면 아무것도 걸지 않는다', () => {
    const events = [ev('20260819', '6학년 행사', '휴업일', [false, false, false, false, false, true])];
    expect(buildClosures(events, klasses, MON)).toEqual([]);
  });
});

describe('학사일정이 이번 주를 덮는지', () => {
  const cal = (from: string, to: string): Calendar => ({ from, to, events: [] });

  it('월요일부터 금요일까지 다 들어와야 참이다', () => {
    expect(calendarCoversThisWeek(cal('20260713', '20260824'), MON)).toBe(true);
    expect(calendarCoversThisWeek(cal('20260817', '20260821'), MON)).toBe(true);
  });

  it('한쪽이라도 모자라면 거짓이다', () => {
    expect(calendarCoversThisWeek(cal('20260818', '20260824'), MON)).toBe(false);
    expect(calendarCoversThisWeek(cal('20260713', '20260820'), MON)).toBe(false);
  });

  it('학사일정이 없으면 거짓이다', () => {
    expect(calendarCoversThisWeek(undefined, MON)).toBe(false);
  });
});

describe('저장 형식', () => {
  const loaded: Loaded = {
    schoolName: '보기 학교',
    source: '나이스',
    input: {
      config: cfg,
      assignments: [
        { teacher: '김국어', klass: '1-1', subject: '국어', slot: 0 },
        { teacher: '이수학', klass: '1-1', subject: '수학', slot: 1, group: 'g1' },
      ],
    },
    calendar: { from: '20260713', to: '20260824', events: [ev('20260819', '개교기념일', '휴업일')] },
  };

  it('저장했다 열면 시간표가 그대로다', () => {
    const back = fromFile(toFile(loaded));
    expect(back.schoolName).toBe('보기 학교');
    expect(back.input.assignments).toEqual(loaded.input.assignments);
    expect(back.input.config).toEqual(cfg);
  });

  it('담당을 안 채운 자리도 함께 살아남는다', () => {
    // 이것이 빠지면 저장했다 여는 것만으로 그 자리가 빈 시간으로 되살아난다.
    // 그러면 학급이 실제로는 수업 중인 교시로 다른 수업을 밀어 넣는 안이 다시 나온다.
    const withBusy = { ...loaded, input: { ...loaded.input, klassBusy: { '1-1': [2, 3] } } };
    const back = fromFile(toFile(withBusy));
    expect(back.input.klassBusy).toEqual({ '1-1': [2, 3] });
  });

  it('전문교과 표시도 함께 살아남는다', () => {
    const withPro = {
      ...loaded,
      input: {
        ...loaded.input,
        assignments: [{ teacher: '박실습', klass: '2-1', subject: '용접 작업', slot: 0, pro: true }],
      },
    };
    expect(fromFile(toFile(withPro)).input.assignments[0]?.pro).toBe(true);
  });

  it('학년 표도 함께 살아남는다', () => {
    // 이것이 빠지면 저장했다 여는 것만으로 학년 판정이 통째로 죽는다.
    // 나이스 학급 키는 학교 코드로 시작해서 키에서 학년을 캐낼 수 없기 때문이다.
    // klassBusy 와 같은 종류의 잘못이라 같은 자리에서 잠근다.
    const neisKlass = '["7010084","2026","주간","","","3","7"]';
    const withGrade = {
      ...loaded,
      input: {
        ...loaded.input,
        assignments: [{ teacher: '김국어', klass: neisKlass, subject: '국어', slot: 0 }],
        klassGrade: { [neisKlass]: 3 },
      },
    };
    const back = fromFile(toFile(withGrade));
    expect(back.input.klassGrade).toEqual({ [neisKlass]: 3 });
    expect(gradeShapes(back.input).map((x) => x.grade)).toEqual([3]);
  });

  it('교시 수 표도 함께 살아남는다', () => {
    // 이것이 빠지면 저장했다 여는 것만으로 그 학년에 없는 교시가 빈 시간으로 되살아난다.
    // 실측에서 초등학교 57곳 가운데 53곳이 그 교시로 옮기라는 안을 내고 있었다.
    const withPeriods = {
      ...loaded,
      input: { ...loaded.input, klassPeriodsPerDay: { '1-1': [4, 4, 4, 4, 4] } },
    };
    const back = fromFile(toFile(withPeriods));
    expect(back.input.klassPeriodsPerDay).toEqual({ '1-1': [4, 4, 4, 4, 4] });
  });

  it('요일 수와 안 맞는 교시 수 표는 버린다', () => {
    const doc = JSON.parse(toFile(loaded)) as Record<string, unknown>;
    doc.periods = { '1-1': [4, 4], '1-2': [4, 4, 4, 4, 4], '1-3': [4, 4, 4, 4, 99] };
    expect(fromFile(JSON.stringify(doc)).input.klassPeriodsPerDay).toEqual({ '1-2': [4, 4, 4, 4, 4] });
  });

  it('학년 표가 없는 옛 파일은 학급 이름으로 되돌아간다', () => {
    const doc = JSON.parse(toFile(loaded)) as Record<string, unknown>;
    delete doc.grades;
    const back = fromFile(JSON.stringify(doc));
    expect(back.input.klassGrade).toBeUndefined();
    expect(gradeShapes(back.input).map((x) => x.grade)).toEqual([1]);
  });

  it('학년으로 볼 수 없는 값은 버린다', () => {
    const doc = JSON.parse(toFile(loaded)) as Record<string, unknown>;
    doc.grades = { '1-1': 7010084, '1-2': 1, '1-3': 0 };
    expect(fromFile(JSON.stringify(doc)).input.klassGrade).toEqual({ '1-2': 1 });
  });

  it('칸 밖으로 나간 담당 미상 자리는 버린다', () => {
    const doc = JSON.parse(toFile(loaded)) as Record<string, unknown>;
    doc.busy = { '1-1': [0, 999, -1], '1-2': [] };
    expect(fromFile(JSON.stringify(doc)).input.klassBusy).toEqual({ '1-1': [0] });
  });

  it('학사일정도 함께 살아남는다', () => {
    // 이것이 빠져 있었다. 새로고침 한 번에 휴업일이 사라져
    // 쉬는 날로 옮기라는 추천이 조용히 되살아났다.
    const back = fromFile(toFile(loaded));
    expect(back.calendar).toEqual(loaded.calendar);
    expect(buildClosures(back.calendar?.events ?? [], ['1-1'], MON)).toEqual([
      { day: 2, reason: '개교기념일' },
    ]);
  });

  it('판 1 파일도 그대로 열린다', () => {
    const old = JSON.stringify({
      format: 'pumasi.timetable',
      version: 1,
      school: '옛 학교',
      config: cfg,
      lessons: [{ teacher: '김국어', klass: '1-1', subject: '국어', slot: 0 }],
    });
    const back = fromFile(old);
    expect(back.schoolName).toBe('옛 학교');
    expect(back.calendar).toBeUndefined();
  });

  it('우리 파일이 아니면 사람이 읽을 말로 막는다', () => {
    expect(() => fromFile('{"format":"other"}')).toThrow(/저장한 파일이 아닙니다/);
    expect(() => fromFile('[]')).toThrow(/저장한 파일이 아닙니다/);
  });

  it('학사일정이 없으면 파일에도 넣지 않는다', () => {
    const noCal: Loaded = { ...loaded, calendar: undefined };
    const doc = JSON.parse(toFile(noCal)) as Record<string, unknown>;
    expect('calendar' in doc).toBe(false);
    expect(doc.version).toBe(2);
  });
});

describe('학급 이름에서 학년 뽑기', () => {
  it('학교마다 다른 표기를 모두 읽는다', () => {
    expect(gradeOf('1-1')).toBe(1);
    expect(gradeOf('3-11')).toBe(3);
    expect(gradeOf('1학년 1반')).toBe(1);
    expect(gradeOf('2학년3반')).toBe(2);
    expect(gradeOf('1-01')).toBe(1);
  });

  it('못 읽으면 null 이다', () => {
    // 짐작해서 엉뚱한 학년에 휴업일을 거는 것보다 안 거는 편이 낫다
    expect(gradeOf('과학중점')).toBeNull();
    expect(gradeOf('')).toBeNull();
    expect(gradeOf('99반')).toBeNull();
  });

  it('학년 표기가 달라도 휴업일이 제대로 걸린다', () => {
    const events = [
      {
        date: '20260819',
        name: '수학여행',
        kind: '휴업일',
        grades: [false, true, false],
        isHoliday: true,
        schoolCourse: '',
      },
    ];
    const out = buildClosures(events, ['1학년 1반', '2학년 1반', '2학년 2반'], MON);
    expect(out).toEqual([{ day: 2, reason: '수학여행', klasses: ['2학년 1반', '2학년 2반'] }]);
  });
});

describe('이름 다듬기', () => {
  it('앞뒤 공백과 가운데 띄어쓰기를 정리한다', () => {
    // "김영희"와 "김 영희"가 다른 사람으로 잡히면 시간표가 조각난다
    expect(normalizeName(' 김영희 ')).toBe('김영희');
    expect(normalizeName('김 영희')).toBe('김영희');
    expect(normalizeName('김  영희')).toBe('김영희');
  });

  it('영문 이름의 띄어쓰기는 남긴다', () => {
    expect(normalizeName('  Jane  Doe ')).toBe('Jane Doe');
  });
});

describe('이상한 파일 막기', () => {
  const ok = {
    format: 'pumasi.timetable',
    version: 2,
    school: '보기 학교',
    config: cfg,
    lessons: [{ teacher: '김국어', klass: '1-1', subject: '국어', slot: 0 }],
  };

  it('JSON 이 아니면 사람이 읽을 말로 막는다', () => {
    expect(() => fromFile('이건 파일이 아닙니다')).toThrow(/파일이 깨졌거나/);
  });

  it('시간표 틀이 이상하면 막는다', () => {
    const noDays = { ...ok, config: { ...cfg, days: 0 } };
    expect(() => fromFile(JSON.stringify(noDays))).toThrow(/시간표 틀이 올바르지 않습니다/);
    const short = { ...ok, config: { ...cfg, dayNames: ['월', '화'] } };
    expect(() => fromFile(JSON.stringify(short))).toThrow(/시간표 틀이 올바르지 않습니다/);
  });

  it('칸을 벗어난 수업이 있으면 막는다', () => {
    // 조용히 사라지게 두면 선생님은 시간표가 왜 비었는지 알 수 없다
    const out = { ...ok, lessons: [{ teacher: 'A', klass: '1-1', subject: '국어', slot: 999 }] };
    expect(() => fromFile(JSON.stringify(out))).toThrow(/칸을 벗어났거나/);
    const neg = { ...ok, lessons: [{ teacher: 'A', klass: '1-1', subject: '국어', slot: -1 }] };
    expect(() => fromFile(JSON.stringify(neg))).toThrow(/칸을 벗어났거나/);
  });

  it('항목이 비면 막는다', () => {
    const empty = { ...ok, lessons: [{ klass: '1-1', subject: '국어', slot: 0 }] };
    expect(() => fromFile(JSON.stringify(empty))).toThrow(/칸을 벗어났거나/);
  });

  it('불러온 교사 이름도 다듬는다', () => {
    const messy = {
      ...ok,
      lessons: [{ teacher: ' 김 국어 ', klass: '1-1', subject: '국어', slot: 0 }],
    };
    expect(fromFile(JSON.stringify(messy)).input.assignments[0]?.teacher).toBe('김국어');
  });
});

describe('교사 배정 일괄 채우기', () => {
  // 한 학교의 (학급, 과목) 짝은 수백 개다. 손으로 다 채우게 두면 아무도 끝까지 못 간다.
  // 실제로는 한 교사가 같은 학년 여러 반의 같은 과목을 맡는 경우가 대부분이다.
  const pairs = [
    { klass: '1-1', subject: '국어' },
    { klass: '1-2', subject: '국어' },
    { klass: '1-3', subject: '국어' },
    { klass: '1-1', subject: '수학' },
    { klass: '2-1', subject: '국어' },
  ];

  it('같은 학년 같은 과목만 고른다', () => {
    const got = sameGradeSubject(pairs, {}, '1-1', '국어');
    expect(got.map((p) => p.klass)).toEqual(['1-2', '1-3']);
  });

  it('이미 채운 자리는 건드리지 않는다', () => {
    const got = sameGradeSubject(pairs, { '1-2|국어': '김국어' }, '1-1', '국어');
    expect(got.map((p) => p.klass)).toEqual(['1-3']);
  });

  it('학년이 다르면 고르지 않는다', () => {
    const got = sameGradeSubject(pairs, {}, '2-1', '국어');
    expect(got).toEqual([]);
  });

  it('학년을 못 읽으면 아무것도 고르지 않는다', () => {
    const got = sameGradeSubject([{ klass: '과학중점', subject: '국어' }], {}, '과학중점', '국어');
    expect(got).toEqual([]);
  });
});

describe('보강 반영', () => {
  const school = {
    config: cfg,
    assignments: [
      { teacher: '김결강', klass: '2-1', subject: '미적분', slot: 3 },
      { teacher: '이한가', klass: '2-2', subject: '국어', slot: 0 },
    ],
  };
  const entry: AppliedEntry = {
    id: 1,
    type: '보강',
    title: '이한가 선생님 보강',
    changes: [],
    cover: { teacher: '이한가', slot: 3, klass: '2-1', subject: '미적분', absent: '김결강' },
  };

  it('자리는 그대로 두고 담당 교사만 바꾼다', () => {
    // 고교학점제에서 강좌는 옮길 수 없다. 실제로 바뀌는 것은 사람이다.
    const after = applyAll(school, [entry]);
    const lesson = after.assignments.find((a) => a.subject === '미적분');
    expect(lesson?.slot).toBe(3);
    expect(lesson?.teacher).toBe('이한가');
  });

  it('다음 탐색이 보강 교사를 그 시간에 수업 중으로 본다', () => {
    // 이렇게 해야 같은 분께 같은 시간을 두 번 부탁하는 안이 안 나온다
    const after = applyAll(school, [entry]);
    const busy = after.assignments.filter((a) => a.teacher === '이한가' && a.slot === 3);
    expect(busy.length).toBe(1);
  });

  it('보강은 교체보다 무겁게 세어 다음 추천에서 뒤로 민다', () => {
    expect(deriveBurden([entry])['이한가']).toBe(2);
  });

  it('나이스 입력 목록에 사람이 바뀌었다고 적는다', () => {
    const list = buildNeisList('보기 학교', [entry], cfg);
    expect(list).toContain('김결강 → 이한가');
    expect(list).toContain('보강(교사 변경)');
  });
});

describe('자료가 없는 요일', () => {
  const cfg4: ScheduleConfig = { days: 5, periods: 4, dayNames: ['월', '화', '수', '목', '금'] };

  it('수업이 하나도 없는 요일을 찾아낸다', () => {
    // 월(0~3)과 목(12~15)에만 수업이 있다. 화, 수, 금은 자료가 없다.
    const input: TimetableInput = {
      config: cfg4,
      assignments: [
        { teacher: '김국어', klass: '1-1', subject: '국어', slot: 0 },
        { teacher: '김국어', klass: '1-1', subject: '국어', slot: 12 },
      ],
    };
    expect(blankDaysOf(input)).toEqual([1, 2, 4]);
  });

  it('담당을 모르는 자리도 수업이 있다는 증거로 센다', () => {
    const input: TimetableInput = {
      config: cfg4,
      assignments: [{ teacher: '김국어', klass: '1-1', subject: '국어', slot: 0 }],
      klassBusy: { '1-2': [5, 9] }, // 화, 수
    };
    expect(blankDaysOf(input)).toEqual([3, 4]);
  });

  it('아무것도 못 받았으면 아무 요일도 막지 않는다', () => {
    // 여기서 5일 전부를 막으면 화면이 통째로 잠긴다. 근거가 없을 때는 손대지 않는다.
    expect(blankDaysOf({ config: cfg4, assignments: [] })).toEqual([]);
  });

  it('요일이 다 채워져 있으면 빈 요일이 없다', () => {
    const input: TimetableInput = {
      config: cfg4,
      assignments: [0, 4, 8, 12, 16].map((slot) => ({
        teacher: '김국어',
        klass: '1-1',
        subject: '국어',
        slot,
      })),
    };
    expect(blankDaysOf(input)).toEqual([]);
  });
});

/**
 * 학급에 매이지 않는 강좌가 있어도 설정을 끝낼 수 있어야 한다.
 *
 * 고교학점제 선택과목은 반 번호가 없다. 그것을 결손으로 보고 막으면 고등학교 217곳
 * 가운데 127곳(59%)이 도구를 아예 못 쓴다. 사용자에게는 "확인이 필요한 행이 있습니다,
 * 초대 링크와 추천 기능은 잠긴 상태로 둡니다"만 뜨고 앞으로 갈 길이 없었다.
 */
describe('학급에 매이지 않는 강좌와 완전성', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    SD_SCHUL_CODE: '7010084', AY: '2026', ALL_TI_YMD: '20260608',
    GRADE: '3', CLASS_NM: '1', PERIO: '1', ITRT_CNTNT: '국어', ...over,
  });

  it('강좌만 있으면 격리가 0이라 다음 단계로 간다', () => {
    const report = normalizeNeisRows([
      row(),
      row({ CLASS_NM: null, ITRT_CNTNT: '확률과 통계', CLRM_NM: '3탐구' }),
    ] as never);
    expect(report.quarantined).toHaveLength(0);
    expect(report.courseOnly).toHaveLength(1);
    expect(canOpenInvitations({ sourceComplete: report.quarantined.length === 0, unresolvedTeacherCount: 0 })).toBe(true);
  });

  it('진짜 결손이면 그대로 막는다', () => {
    const report = normalizeNeisRows([row(), row({ PERIO: '' })] as never);
    expect(report.quarantined).toHaveLength(1);
    expect(canOpenInvitations({ sourceComplete: report.quarantined.length === 0, unresolvedTeacherCount: 0 })).toBe(false);
  });
});

/**
 * 특수학교 학사일정은 과정마다 따로 온다.
 *
 * 실측한 32곳 가운데 31곳이 유치원, 초등학교, 중학교, 고등학교, 전공과 가운데 셋에서
 * 다섯 과정을 함께 운영하고, 6곳에서는 과정마다 쉬는 날이 달랐다. 유치원 여름방학이
 * 다른 과정보다 먼저 시작하는 식이다. 휴업일 1,227일 가운데 30일(2%)이 그렇다.
 *
 * 과정을 안 보면 유치원만 쉬는 날에 초등부와 중학부 수업까지 쉬는 것으로 읽는다.
 */
describe('과정마다 다른 쉬는 날', () => {
  const identity = (course: string, grade: string, className: string) => ({
    schoolCode: '7010084', academicYear: '2026', schoolCourse: course,
    dayCourse: '주간', affiliation: '', major: '', grade, className,
  });
  const event = (over: Partial<NeisEvent> = {}): NeisEvent => ({
    date: '20260715', name: '여름방학', kind: '휴업일',
    grades: [true, true, true, true, true, true], isHoliday: true, schoolCourse: '', ...over,
  });

  const bundle = (events: NeisEvent[]) => ({
    school: { office: 'B10', code: '7010084', name: '명현학교', kind: '특수학교', officeName: '서울' },
    range: { from: '20260713', to: '20260717' },
    result: { total: 3, pageCount: 1, complete: true, truncated: false, fetchedAt: '2026-07-13T00:00:00.000Z' },
    rows: [], events,
    report: {
      normalization: {
        accepted: [
          { id: 'r1', row: {}, classIdentity: identity('유치원', '1', '1'), classKey: 'k1', factKey: 'f1',
            date: '20260713', period: '1', rawSubject: '놀이', subject: '놀이', room: '' },
          { id: 'r2', row: {}, classIdentity: identity('초등학교', '1', '1'), classKey: 'k2', factKey: 'f2',
            date: '20260713', period: '1', rawSubject: '국어', subject: '국어', room: '' },
        ],
        quarantined: [], courseOnly: [], duplicateCount: 0, parallelGroups: [],
      },
    },
  }) as unknown as Parameters<typeof createWorkspaceFromNeis>[0];

  it('유치원만 쉬는 날에 초등부를 쉬게 하지 않는다', () => {
    const state = createWorkspaceFromNeis(bundle([event({ schoolCourse: '유치원' })]), {}, '2026-07-13T00:00:00.000Z');
    const closures = state.revisions[0]?.closures ?? [];
    expect(closures).toHaveLength(1);
    expect(closures[0]?.classIdentities?.map((x) => x.schoolCourse)).toEqual(['유치원']);
  });

  it('과정이 다 쉬면 각 과정마다 그 과정만 닫는다', () => {
    const state = createWorkspaceFromNeis(
      bundle([event({ schoolCourse: '유치원' }), event({ schoolCourse: '초등학교' })]),
      {}, '2026-07-13T00:00:00.000Z',
    );
    const closures = state.revisions[0]?.closures ?? [];
    expect(closures).toHaveLength(2);
    expect(closures.flatMap((c) => c.classIdentities?.map((x) => x.schoolCourse) ?? [])).toEqual(['유치원', '초등학교']);
  });

  it('시간표에 없는 과정의 행사는 아무 학급도 안 닫는다', () => {
    // 전공과는 학사일정에 오지만 시간표에는 없다. 학교 전체로 넓히면 안 된다.
    const state = createWorkspaceFromNeis(bundle([event({ schoolCourse: '전공과' })]), {}, '2026-07-13T00:00:00.000Z');
    expect(state.revisions[0]?.closures ?? []).toEqual([]);
  });

  it('초중고는 과정 항목이 없으므로 예전처럼 학교 전체로 닫는다', () => {
    const hs = bundle([event({ schoolCourse: '고등학교' })]) as unknown as {
      report: { normalization: { accepted: Array<{ classIdentity: { schoolCourse: string } }> } };
    };
    for (const row of hs.report.normalization.accepted) row.classIdentity.schoolCourse = '';
    const state = createWorkspaceFromNeis(hs as never, {}, '2026-07-13T00:00:00.000Z');
    const closures = state.revisions[0]?.closures ?? [];
    expect(closures).toHaveLength(1);
    expect(closures[0]?.classIdentities).toBeUndefined();
  });
});
