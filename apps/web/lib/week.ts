/**
 * 주와 날짜 셈.
 *
 * 같은 셈을 두 군데에 적어 두면 한쪽만 고치게 된다. 이 저장소에서 그 일이 이미
 * 여러 번 있었다. 부담 세는 기간이 그 예다. 엔진에 넘기는 쪽은 네 주로 세고,
 * 관제판 경고는 활성 개정판으로 걸러 한 주만 세고 있었다. 같은 "최근"이라는 말이
 * 두 화면에서 다른 기간을 가리켰다.
 */

/** 날짜에 날 수를 더한다. UTC 로 셈해 서머타임이 없는 자리에서도 흔들리지 않는다. */
export function dateAtUtcOffset(date: string, offset: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

/** 그 날짜가 든 주의 월요일. 일요일은 앞 주로 본다. */
export function mondayOf(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  const day = value.getUTCDay();
  return dateAtUtcOffset(date, day === 0 ? -6 : 1 - day);
}

/** 월요일을 0으로 놓은 요일 번호. 그 주 밖이면 0..4 를 벗어난다. */
export function dayIndex(date: string, monday: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${monday}T00:00:00.000Z`)) / 86_400_000,
  );
}

/** 부담을 세는 기간. 이 주와 앞의 세 주다. */
export const BURDEN_WEEKS = 4;
