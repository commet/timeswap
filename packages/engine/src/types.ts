/** 주간 시간표의 좌표계. 슬롯 = day * periods + period. */
export interface ScheduleConfig {
  days: number;
  periods: number;
  dayNames: string[];
  /**
   * 점심시간이 몇 교시 뒤에 오는지. 4 이면 4교시와 5교시 사이가 점심이다.
   * 점심을 사이에 두고 수업이 이어 붙는 것을 가려내는 데 쓴다. 없으면 가운데로 본다.
   */
  lunchAfterPeriod?: number;
  /**
   * 요일별 교시 수. 없으면 모든 요일이 periods 만큼이라고 본다.
   *
   * 수요일 단축수업이나 금요일 6교시 없음처럼 요일마다 교시 수가 다른 학교가 많다.
   * 격자는 네모라 없는 시간도 빈 칸으로 보이고, 그대로 두면 없는 교시로 옮기라는
   * 추천이 나온다. 학교 자료에서 읽어 낼 수 있을 때만 채운다.
   */
  periodsPerDay?: number[];
}

/** 수업 1개. group 은 분반, 동시수업 묶음 식별자(있으면 v0 엔진은 이동 후보에서 제외). */
export interface Assignment {
  teacher: string;
  klass: string;
  subject: string;
  slot: number;
  group?: string;
  /**
   * 전문교과 실습인지. 나이스 자료에서는 과목명 앞의 별표로 온다.
   *
   * 특성화고와 마이스터고의 전공 실습 과목이 여기 걸린다. 학과 전용 실습실에서
   * 그 학과 교사만 맡는 수업이라 교체 상대가 사실상 없다.
   * 일반고에는 거의 없다. 실측에서 일반고 12곳은 0%, 특성화고 10곳은 14~34%였다.
   */
  pro?: boolean;
}

/**
 * 그날 수업을 하지 않는 날.
 *
 * 시간표는 한 주가 되풀이되는 표지만 학사일정은 날짜로 온다.
 * 그래서 지금 다루는 주에 맞춰 요일로 바꿔 넣는다.
 * 휴업일인 목요일로 수업을 옮기라는 추천이 한 번이라도 나오면
 * 그 뒤로 어떤 추천도 믿기 어려워진다.
 */
export interface DayClosure {
  /** 요일. 0 이 월요일이다 */
  day: number;
  /** 왜 쉬는지. 화면과 근거 문장에 그대로 쓴다 */
  reason: string;
  /**
   * 해당 학급. 비우면 학교 전체다.
   * 특정 학년만 행사로 빠지는 경우에 쓴다.
   */
  klasses?: string[];
}

export interface TimetableInput {
  config: ScheduleConfig;
  assignments: Assignment[];
  /**
   * 학급별로 "수업은 있는데 담당 교사를 모르는" 교시.
   *
   * 나이스 학급 시간표에는 교사가 없어서 (학급, 과목)을 교사로 잇는 표는 사람이 채운다.
   * 학교 하나에 그 짝이 수백 개라 처음부터 다 채우고 시작하는 사람은 없다.
   * 덜 채운 칸을 배정에서 빼면 그 자리가 빈 시간으로 보이고, 학급이 실제로는
   * 수업 중인 교시로 다른 수업을 밀어 넣는 안이 나온다.
   *
   * 실제 특성화고 자료에서 표를 60%만 채우고 재어 보니 추천안 459개에
   * 그런 이동이 282건 들어 있었다.
   *
   * 그래서 담당을 몰라도 "그 시간은 차 있다"는 사실만 따로 들고 간다.
   * 그 자리로는 옮기지 않고, 빈 시간 계산에도 수업으로 센다.
   * 다만 교사를 모르므로 그 수업 자체를 옮기거나 맞바꾸는 대상으로는 삼지 않는다.
   */
  klassBusy?: Record<string, number[]>;
  /**
   * 학급이 몇 학년인지.
   *
   * 학급 키에서 숫자를 캐내 학년으로 쓰던 것을 그만두고 명시로 받는다.
   * 나이스 자료의 학급 키는 `["7010084","2026","주간","","","1","1"]` 처럼
   * 학교 코드가 앞에 오는 구조화된 값이다. 여기서 첫 숫자를 학년으로 읽으면
   * 학교 코드를 학년으로 읽는다. 실제 학교 217곳을 넣어 보니 학년 판정이
   * 전부 빈 값이었고, 학년 안내가 한 번도 뜨지 않았다.
   *
   * 없으면 학급 키 앞머리의 숫자로 되돌아간다. `1-3` 처럼 사람이 적은 표를
   * 그대로 쓰는 경우가 있어서다.
   */
  klassGrade?: Record<string, number>;
  /** 교사별 근무 불가 슬롯(연수, 출장 고정 시간 등) */
  unavailable?: Record<string, number[]>;
  /** 교사별 최근 보강, 교환 부담 횟수. 추천 시 부담 균형 감점에 쓴다. */
  recentBurden?: Record<string, number>;
  /** 학사일정에서 온 휴업일과 학년 행사. 그 요일로는 옮기지 않는다. */
  closures?: DayClosure[];
}

export type CandidateType = 'move' | 'swap2' | 'cycle3';

/** 수업 1개의 이동: from 의 수업을 toSlot 으로 옮긴다. */
export interface Change {
  from: Assignment;
  toSlot: number;
}

export interface TraceEntry {
  kind: '조건' | '감점' | '가점';
  text: string;
  points?: number;
}

export interface Candidate {
  type: CandidateType;
  title: string;
  changes: Change[];
  /**
   * 자리를 옮기는 묶음의 수. 분반과 이동수업은 여러 수업이 한 몸으로 움직이므로
   * changes 의 길이와 다르다. 사람이 내리는 결정의 수는 이쪽이다.
   */
  unitCount?: number;
  score: number;
  trace: TraceEntry[];
}
