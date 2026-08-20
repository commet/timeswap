import type { NeisLoadBundle } from './SetupFlow';

const displayYmd = (value: string): string =>
  value.length === 8 ? `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}` : value;

export function DataHealthPanel({ bundle }: { bundle: NeisLoadBundle }) {
  const { normalization } = bundle.report;
  const academicYear = normalization.accepted[0]?.classIdentity.academicYear || '확인 필요';
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
        <div><dt>마지막 불러오기</dt><dd>{new Date(bundle.result.fetchedAt).toLocaleString('ko-KR')}</dd></div>
      </dl>
      {!complete && (
        <p className="setup-alert" role="alert">
          일부 공식 행을 온전히 확인하지 못했습니다. 초대 링크와 추천 기능은 잠긴 상태로 둡니다.
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
