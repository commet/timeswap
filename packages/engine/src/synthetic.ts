import type { Assignment, ScheduleConfig, TimetableInput } from './types.js';
import { slotOf } from './slots.js';

/** 결정적 의사 난수 (mulberry32). 같은 시드는 같은 학교를 만든다. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 한국 중고교의 통상 주간 편제를 흉내 낸 과목과 주당 시수 (합 32시간). */
export const SUBJECT_HOURS: ReadonlyArray<readonly [string, number]> = [
  ['국어', 4],
  ['수학', 4],
  ['영어', 4],
  ['과학', 3],
  ['사회', 3],
  ['체육', 3],
  ['역사', 2],
  ['음악', 2],
  ['미술', 2],
  ['기술가정', 2],
  ['정보', 2],
  ['도덕', 1],
];

export interface SyntheticOptions {
  classes?: number;
  seed?: number;
  /** 교사 1인 주당 최대 담당 시수 산정 기준. 작을수록 교사가 많아진다. */
  teacherLoad?: number;
}

/**
 * 검증을 통과하는 완전한 합성 학교 시간표를 만든다.
 * 반별 과목 담당 교사를 먼저 배정하고, 슬롯 단위 무작위 그리디로 배치한다.
 * 그리디가 막히면 시드를 밀며 재시도한다(결정적).
 */
export function genSchool(opts: SyntheticOptions = {}): TimetableInput {
  const classes = opts.classes ?? 30;
  const baseSeed = opts.seed ?? 1;
  const teacherLoad = opts.teacherLoad ?? 15;
  const cfg: ScheduleConfig = {
    days: 5,
    periods: 7,
    dayNames: ['월', '화', '수', '목', '금'],
  };
  const lessonsPerDay = [7, 7, 6, 6, 6]; // 합 32

  const klassNames: string[] = [];
  for (let i = 0; i < classes; i++) {
    const grade = (i % 3) + 1;
    const no = Math.floor(i / 3) + 1;
    klassNames.push(`${grade}-${no}`);
  }

  // 과목별 교사 풀과 반 담당 배정 (라운드 로빈)
  const teacherOf = new Map<string, string>(); // `${klass}|${subject}` -> teacher
  for (const [subject, hours] of SUBJECT_HOURS) {
    const teacherCount = Math.max(1, Math.ceil((classes * hours) / teacherLoad));
    for (let i = 0; i < classes; i++) {
      const t = `${subject}${(i % teacherCount) + 1}`;
      teacherOf.set(`${klassNames[i]}|${subject}`, t);
    }
  }

  for (let attempt = 0; attempt < 300; attempt++) {
    const rng = mulberry32(baseSeed * 1000 + attempt);
    const result = tryBuild(cfg, lessonsPerDay, klassNames, teacherOf, rng);
    if (result) return { config: cfg, assignments: result };
  }
  throw new Error('합성 시간표 생성 실패: 재시도 한도를 넘었습니다');
}

function tryBuild(
  cfg: ScheduleConfig,
  lessonsPerDay: number[],
  klassNames: string[],
  teacherOf: Map<string, string>,
  rng: () => number,
): Assignment[] | null {
  const remaining = new Map<string, Map<string, number>>();
  for (const k of klassNames) {
    remaining.set(k, new Map(SUBJECT_HOURS.map(([s, h]) => [s, h])));
  }
  const assignments: Assignment[] = [];

  for (let day = 0; day < cfg.days; day++) {
    const usedToday = new Map<string, Set<string>>(klassNames.map((k) => [k, new Set()]));
    for (let period = 0; period < (lessonsPerDay[day] ?? 0); period++) {
      const slot = slotOf(day, period, cfg);
      const placed = placeSlot(klassNames, remaining, usedToday, teacherOf, slot, rng);
      if (!placed) return null;
      assignments.push(...placed);
    }
  }
  return assignments;
}

function placeSlot(
  klassNames: string[],
  remaining: Map<string, Map<string, number>>,
  usedToday: Map<string, Set<string>>,
  teacherOf: Map<string, string>,
  slot: number,
  rng: () => number,
): Assignment[] | null {
  // 슬롯 하나를 통째로 배치한다. 선택지가 가장 적은 학급부터 채우는
  // MRV 휴리스틱으로 교착을 줄이고, 막히면 무작위성을 바꿔 재시도한다.
  for (let retry = 0; retry < 80; retry++) {
    const busy = new Set<string>();
    const placed: Assignment[] = [];
    const pending = shuffle([...klassNames], rng);
    let ok = true;
    while (pending.length > 0) {
      let bestIdx = -1;
      let bestOpts: string[] | null = null;
      for (let i = 0; i < pending.length; i++) {
        const klass = pending[i];
        if (klass === undefined) return null;
        const rem = remaining.get(klass);
        if (!rem) return null;
        const opts: string[] = [];
        for (const [subject, hours] of rem) {
          if (hours <= 0) continue;
          const t = teacherOf.get(`${klass}|${subject}`);
          if (t !== undefined && !busy.has(t)) opts.push(subject);
        }
        if (opts.length === 0) {
          bestIdx = i;
          bestOpts = opts;
          break;
        }
        if (bestOpts === null || opts.length < bestOpts.length) {
          bestIdx = i;
          bestOpts = opts;
        }
      }
      if (bestOpts === null || bestOpts.length === 0) {
        ok = false;
        break;
      }
      const klass = pending.splice(bestIdx, 1)[0];
      if (klass === undefined) return null;
      const used = usedToday.get(klass);
      if (!used) return null;
      const fresh = bestOpts.filter((s) => !used.has(s));
      const pool = fresh.length > 0 ? fresh : bestOpts;
      const subject = pool[Math.floor(rng() * pool.length)];
      if (subject === undefined) return null;
      const teacher = teacherOf.get(`${klass}|${subject}`);
      if (!teacher) return null;
      busy.add(teacher);
      placed.push({ teacher, klass, subject, slot });
    }
    if (ok) {
      for (const a of placed) {
        const rem = remaining.get(a.klass);
        rem?.set(a.subject, (rem.get(a.subject) ?? 0) - 1);
        usedToday.get(a.klass)?.add(a.subject);
      }
      return placed;
    }
  }
  return null;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a !== undefined && b !== undefined) {
      arr[i] = b;
      arr[j] = a;
    }
  }
  return arr;
}
