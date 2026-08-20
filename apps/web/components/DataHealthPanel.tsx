import type { NeisLoadBundle } from './SetupFlow';

const displayYmd = (value: string): string =>
  value.length === 8 ? `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}` : value;

/** 그 주의 월요일이 이번 주 월요일보다 몇 주 앞인지. 음수는 0으로 본다. */
function weeksBetween(from: string, now: Date): number {
  if (from.length !== 8) return 0;
  const start = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(4, 6)) - 1, Number(from.slice(6, 8)));
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const monday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    - ((today.getUTCDay() + 6) % 7) * 86_400_000;
  return Math.max(0, Math.round((monday - start) / (7 * 86_400_000)));
}

export function DataHealthPanel({ bundle, now = new Date() }: { bundle: NeisLoadBundle; now?: Date }) {
  const { normalization } = bundle.report;
  const academicYear = normalization.accepted[0]?.classIdentity.academicYear || '확인 필요';
  /*
   * 어느 학기 시간표인지 밝힌다.
   *
   * 앱은 최근 5주를 거슬러 보고 수업이 있는 첫 주를 쓴다. 그래서 방학을 건너뛰어
   * 지난 학기 시간표를 가져오는 일이 생긴다. 오늘(8월 20일) 기준으로 실제로 재니
   * 120곳 가운데 16곳이 한 달 전인 7월 20일 주를 찾았고 그 열여섯 곳이 모두 1학기였다.
   *
   * 학기가 바뀌면 과목도 교사도 교시 수도 달라진다. 1학기 시간표로 2학기 교체를
   * 계획하면 통째로 틀린다.
   *
   * 그런데 날짜로 학기를 짐작하면 안 된다. 방학 길이가 학교마다 달라 같은 주에도
   * 1학기인 학교와 2학기인 학교가 섞인다. 실측에서 현재 주를 찾은 94곳 가운데
   * 47곳이 1학기, 47곳이 2학기였다. 그래서 판정하지 않고 사실만 적는다.
   * 이 시간표가 몇 학기 것이고 몇 주 전 것인지는 선생님이 보면 바로 아신다.
   */
  const semesters = [...new Set(bundle.rows.map((row) => (row.SEM ?? '').trim()).filter(Boolean))].sort();
  const weeksBack = weeksBetween(bundle.range.from, now);
  /*
   * 학급에 매이지 않는 강좌는 결손이 아니다. 고교학점제 선택과목이라 반 번호가 없다.
   * 그것으로 막으면 고등학교 217곳 가운데 127곳이 설정을 끝낼 수 없다.
   */
  const complete = bundle.result.complete && normalization.quarantined.length === 0;
  const courses = normalization.courseOnly.length;

  return (
    <section className="data-health" aria-labelledby="data-health-title">
      <header>
        <div>
          <span className="eyebrow">공식 자료 점검</span>
          <h2 id="data-health-title">{complete ? '안전하게 다음 단계로 갈 수 있습니다' : '확인이 필요한 행이 있습니다'}</h2>
        </div>
        <span className={`health-status ${complete ? 'complete' : 'blocked'}`}>
          {complete ? '완전' : '중단'}
        </span>
      </header>
      <dl className="health-grid">
        <div><dt>공식 전체 행</dt><dd>{bundle.result.total.toLocaleString()}행</dd></div>
        <div><dt>받은 페이지</dt><dd>{bundle.result.pageCount.toLocaleString()}쪽</dd></div>
        <div><dt>사용 가능</dt><dd>{normalization.accepted.length.toLocaleString()}행</dd></div>
        <div><dt>격리</dt><dd>{normalization.quarantined.length.toLocaleString()}행</dd></div>
        <div><dt>학급 없는 강좌</dt><dd>{courses.toLocaleString()}행</dd></div>
        <div><dt>정확 중복</dt><dd>{normalization.duplicateCount.toLocaleString()}행</dd></div>
        <div><dt>분반 의심</dt><dd>{normalization.parallelGroups.length.toLocaleString()}묶음</dd></div>
        <div><dt>선택한 수업 주</dt><dd>{displayYmd(bundle.range.from)}–{displayYmd(bundle.range.to)}</dd></div>
        <div><dt>학년도</dt><dd>{academicYear}학년도</dd></div>
        <div><dt>학기</dt><dd>{semesters.length ? semesters.map((x) => `${x}학기`).join(', ') : '확인 필요'}</dd></div>
        <div><dt>마지막 불러오기</dt><dd>{new Date(bundle.result.fetchedAt).toLocaleString('ko-KR')}</dd></div>
      </dl>
      {!complete && (
        <p className="setup-alert" role="alert">
          일부 공식 행을 온전히 확인하지 못했습니다. 초대 링크와 추천 기능은 잠긴 상태로 둡니다.
        </p>
      )}
      {weeksBack > 0 && (
        <p className="setup-note" role="status">
          이 시간표는 {weeksBack}주 전 주간입니다. 그 뒤로는 공개된 수업이 없어 가장 최근
          수업 주를 가져왔습니다. 방학을 건너뛰면 지난 학기 시간표일 수 있습니다.
          위의 학기 표시를 확인하십시오.
        </p>
      )}
      {courses > 0 && (
        <p className="setup-note" role="status">
          학급에 매이지 않는 강좌가 {courses.toLocaleString()}행 있습니다. 고교학점제 선택과목처럼
          수강생이 여러 학급에서 모이는 수업이라 반 번호가 없습니다. 자료가 잘못된 것이 아니며
          다음 단계로 갈 수 있습니다. 다만 어느 학급 학생이 듣는지 알 수 없어 시간표에는 넣지
          않습니다. 그 수업의 교체와 보강은 이 도구로 다룰 수 없습니다.
        </p>
      )}
    </section>
  );
}
