import {
  fromComcigan,
  genSchool,
  type Candidate,
  type ComciganAdaptResult,
  type ComciganData,
  type ScheduleConfig,
} from '@timeswap/engine';

export const STORAGE_KEY = 'timeswap:v0:data';
export const TEACHER_KEY = 'timeswap:v0:teacher';

/** 샘플 파일이 없는 배포 환경에서 쓰는 합성 샘플 표식 */
export const SYNTH_MARK = 'timeswap:synthetic:v1';

export interface Loaded {
  adapted: ComciganAdaptResult;
  source: '샘플' | '업로드';
}

export function parseAndAdapt(raw: string, source: Loaded['source']): Loaded {
  if (raw === SYNTH_MARK) {
    return {
      adapted: {
        input: genSchool({ classes: 12, seed: 42 }),
        schoolName: '수업품앗이 시범 학교',
        changedLessons: 0,
        groupedLessons: 0,
      },
      source,
    };
  }
  const json = JSON.parse(raw) as ComciganData;
  if (!json || typeof json !== 'object' || !json.timetable) {
    throw new Error('시간표 형식이 맞지 않습니다. 컴시간 뷰어 JSON 파일을 올려 주십시오.');
  }
  return { adapted: fromComcigan(json), source };
}

export function saveRaw(raw: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // 저장 실패(용량 초과 등)는 치명적이지 않다. 세션 안에서는 계속 쓸 수 있다.
  }
}

export function loadRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearRaw(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TEACHER_KEY);
  } catch {
    /* 무시 */
  }
}

/* 과목 이름이 hue 를 정한다. 채도와 명도는 테마 토큰이 정한다. */
const HUES = [152, 200, 222, 250, 280, 310, 335, 15, 35, 60, 95, 175];

export function subjectHue(subject: string): number {
  let h = 0;
  for (let i = 0; i < subject.length; i++) h = (h * 31 + subject.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length] ?? 152;
}

/** 상대 교사에게 보낼 합쇼체 요청 문구를 만든다. */
export function buildPhrase(cand: Candidate, cfg: ScheduleConfig, slotName: (s: number, c: ScheduleConfig) => string): string {
  const mine = cand.changes[0];
  if (!mine) return '';
  const from = slotName(mine.from.slot, cfg);
  if (cand.type === 'swap2') {
    const theirs = cand.changes[1];
    if (!theirs) return '';
    const to = slotName(theirs.from.slot, cfg);
    return [
      `${theirs.from.teacher} 선생님, 안녕하십니까.`,
      `${from} ${mine.from.klass} ${mine.from.subject} 수업에 부득이한 사정이 생겨 연락드립니다.`,
      `선생님의 ${to} ${theirs.from.klass} ${theirs.from.subject} 수업과 맞바꿔 주실 수 있으신지 여쭙습니다.`,
      `가능하시면 제가 시간 변경원을 올리겠습니다. 감사합니다.`,
    ].join('\n');
  }
  if (cand.type === 'cycle3') {
    const names = cand.changes.map((c) => `${c.from.teacher} 선생님`).slice(1).join(', ');
    const lines = cand.changes
      .map((c) => `${slotName(c.from.slot, cfg)} ${c.from.subject}(${c.from.teacher}) → ${slotName(c.toSlot, cfg)}`)
      .join('\n');
    return [
      `${names}, 안녕하십니까.`,
      `${from} ${mine.from.klass} 수업에 부득이한 사정이 생겨, 세 수업을 한 자리씩 옮기는 방안을 여쭙습니다.`,
      lines,
      `동의해 주시면 제가 시간 변경원을 올리겠습니다. 감사합니다.`,
    ].join('\n');
  }
  const to = slotName(mine.toSlot, cfg);
  return [
    `일과 담당 선생님, 안녕하십니까.`,
    `${from} ${mine.from.klass} ${mine.from.subject} 수업에 부득이한 사정이 생겨,`,
    `해당 수업을 ${to}(${mine.from.klass}의 빈 교시)로 옮기고자 합니다.`,
    `학급 하루 수업에 중간 빈틈은 생기지 않습니다. 검토 부탁드립니다. 감사합니다.`,
  ].join('\n');
}
