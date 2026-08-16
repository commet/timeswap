import type { Assignment, ScheduleConfig, TimetableInput } from './../types.js';
import { slotOf } from './../slots.js';

/**
 * 컴시간알리미 계열 뷰어가 쓰는 전체 시간표 JSON(학년 > 반 > 셀 배열)을
 * 엔진 입력으로 바꾼다. 셀 좌표는 배열 인덱스 대신 셀 안의 weekday 와
 * classTime 값을 믿는다(서식 변형에 강하다).
 *
 * isChanged 셀은 changeInfo(결보강, 수업 변경 반영본)를 우선한다.
 * 즉 이 어댑터의 결과는 "이번 주에 실제로 돌아가는" 시간표다.
 */

export interface ComciganCell {
  grade?: number;
  class?: number;
  weekday: number; // 1 = 월
  classTime: number; // 1부터
  subject?: string;
  teacher?: string;
  isChanged?: boolean;
  changeInfo?: { subject?: string; teacher?: string } | null;
}

export interface ComciganData {
  schoolInfo?: { name?: string };
  timetable: Record<string, Record<string, ComciganCell[][]>>;
}

export interface ComciganAdaptResult {
  input: TimetableInput;
  schoolName: string;
  /** 원본에서 학기 중 변경(isChanged)이 반영된 수업 수 */
  changedLessons: number;
  /** 같은 교사가 같은 교시에 두 학급 이상에 잡혀 group 으로 묶인 수업 수 */
  groupedLessons: number;
}

export function fromComcigan(data: ComciganData, opts: { useChanges?: boolean } = {}): ComciganAdaptResult {
  const useChanges = opts.useChanges !== false;
  let maxDay = 5;
  let maxPeriod = 7;
  const cells: Array<{ klass: string; cell: ComciganCell }> = [];
  for (const [grade, classes] of Object.entries(data.timetable)) {
    for (const [klassNo, rows] of Object.entries(classes)) {
      for (const row of rows) {
        for (const cell of row) {
          if (!cell || typeof cell.weekday !== 'number') continue;
          maxDay = Math.max(maxDay, cell.weekday);
          maxPeriod = Math.max(maxPeriod, cell.classTime);
          cells.push({ klass: `${grade}-${klassNo}`, cell });
        }
      }
    }
  }
  const cfg: ScheduleConfig = {
    days: maxDay,
    periods: maxPeriod,
    dayNames: ['월', '화', '수', '목', '금', '토', '일'].slice(0, maxDay),
  };

  let changedLessons = 0;
  const assignments: Assignment[] = [];
  const seenKlassSlot = new Set<string>();
  for (const { klass, cell } of cells) {
    let subject = cell.subject ?? '';
    let teacher = cell.teacher ?? '';
    if (useChanges && cell.isChanged && cell.changeInfo?.subject) {
      subject = cell.changeInfo.subject;
      teacher = cell.changeInfo.teacher ?? teacher;
      changedLessons++;
    }
    if (!subject || !teacher) continue;
    const slot = slotOf(cell.weekday - 1, cell.classTime - 1, cfg);
    const kk = `${klass}|${slot}`;
    if (seenKlassSlot.has(kk)) continue; // 같은 칸 중복 셀은 첫 값을 쓴다
    seenKlassSlot.add(kk);
    assignments.push({ teacher, klass, subject, slot });
  }

  // 같은 교사가 같은 교시에 여러 학급을 맡으면 분반, 동시수업으로 보고 묶는다.
  const byTeacherSlot = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const key = `${a.teacher}|${a.slot}`;
    const list = byTeacherSlot.get(key);
    if (list) list.push(a);
    else byTeacherSlot.set(key, [a]);
  }
  let groupedLessons = 0;
  for (const [key, list] of byTeacherSlot) {
    if (list.length > 1) {
      for (const a of list) {
        a.group = `sim-${key}`;
        groupedLessons++;
      }
    }
  }

  return {
    input: { config: cfg, assignments },
    schoolName: data.schoolInfo?.name ?? '이름 없는 학교',
    changedLessons,
    groupedLessons,
  };
}
