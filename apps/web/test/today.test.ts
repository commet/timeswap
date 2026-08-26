import { describe, expect, it } from 'vitest';
import { localDate } from '../lib/today';
import { todayOf } from '../components/Workbench';
import { loadDemoScenario } from '../lib/demo';
import type { WorkspaceState } from '../lib/domain';

/**
 * 오늘을 UTC 날짜로 구하고 있었다.
 *
 * 한국은 UTC+9 라서 자정부터 아침 9시까지는 `toISOString()` 이 어제를 준다.
 * 선생님이 1교시 전에 시간표를 확인하는 시간대가 정확히 거기다. 그 시간에 열면
 * 일과 담당 관제판의 오늘 건수가 어제 것이 되고, 학급 공개 시간표도 어제가 떴다.
 *
 * 교사 화면은 지역 날짜를 쓰고 있었다. 그래서 아침마다 두 화면이 서로 다른 날을
 * 오늘이라고 불렀다. 이 검사는 `Asia/Seoul` 에서 돈다. UTC 에서 돌리면 두 값이
 * 같아져서 이 잘못이 안 보인다.
 */
const seoulMidnight = new Date('2026-08-17T15:30:00.000Z');
const seoulEvening = new Date('2026-08-18T11:00:00.000Z');

const schoolState = (): WorkspaceState => {
  const demo = loadDemoScenario('full-day-absence');
  return {
    ...demo,
    revisions: demo.revisions.map((revision) => ({ ...revision, source: 'school_file' as const })),
  };
};

describe('오늘은 이 기기의 날짜다', () => {
  it('검사가 한국 시간대에서 돈다', () => {
    // 이것이 깨지면 아래 검사들이 UTC 에서 돌아 아무것도 못 잡는다.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Seoul');
  });

  it('자정 넘은 새벽에 어제로 밀리지 않는다', () => {
    // 서울 8월 18일 0시 30분. UTC 로는 아직 8월 17일이다.
    expect(seoulMidnight.toISOString().slice(0, 10)).toBe('2026-08-17');
    expect(localDate(seoulMidnight)).toBe('2026-08-18');
  });

  it('낮에는 UTC 날짜와 같다', () => {
    expect(localDate(seoulEvening)).toBe('2026-08-18');
  });

  it('일과 담당 화면도 같은 날을 쓴다', () => {
    expect(todayOf(schoolState(), seoulMidnight)).toBe('2026-08-18');
  });

  it('예시 자료는 정해진 날을 그대로 쓴다', () => {
    // 예시는 언제 열어도 같은 화면이어야 한다. 오늘이 바뀌면 설명이 안 맞는다.
    expect(todayOf(loadDemoScenario('full-day-absence'), seoulMidnight)).toBe('2026-08-18');
  });
});
