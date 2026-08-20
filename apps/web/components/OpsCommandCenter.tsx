'use client';

import type { ReactNode } from 'react';

import type { DemoScenarioId } from '../lib/demo';
import type { OpsDashboardView } from '../lib/projections';
import type { OpsCaseView, OpsTimelineMarker } from '../lib/ops-command-center';
import type { WorkspaceState } from '../lib/domain';
import type { SaveResult } from '../lib/repository';
import { DemoScenarioPicker } from './DemoScenarioPicker';

export type OpsCommandCenterProps = {
  dashboard: OpsDashboardView;
  cases: OpsCaseView[];
  timeline: OpsTimelineMarker[];
  selectedCaseId?: string;
  onSelectCase(caseId: string): void;
  onOpenScenario(id: DemoScenarioId): SaveResult;
  scenarioState: WorkspaceState;
  detail: ReactNode;
  administration: ReactNode;
  onBackToList(): void;
  onReturnToCase(): void;
  step?: 'case' | 'admin';
};

/** 자료가 어디서 왔는지. 영문 코드를 그대로 보여 주지 않는다. */
const SOURCE_LABEL: Record<string, string> = {
  neis: '나이스',
  school_file: '학교 파일',
  demo: '예시 자료',
  none: '미확인',
};

const metrics: Array<{ key: keyof Pick<OpsDashboardView, 'todayChanges' | 'unresolvedLessons' | 'pendingCases' | 'neisTasks' | 'publicationTasks' | 'burdenAlerts'>; label: string }> = [
  { key: 'todayChanges', label: '오늘 게시된 변경' },
  { key: 'unresolvedLessons', label: '미해결 수업' },
  { key: 'pendingCases', label: '승인 대기' },
  { key: 'neisTasks', label: '나이스 대기' },
  { key: 'publicationTasks', label: '게시 대기' },
  { key: 'burdenAlerts', label: '부담 경고' },
];

export function OpsCommandCenter({
  dashboard,
  cases,
  timeline,
  selectedCaseId,
  onSelectCase,
  onOpenScenario,
  scenarioState,
  detail,
  administration,
  onBackToList,
  onReturnToCase,
  step,
}: OpsCommandCenterProps) {
  const mobileStep = step ?? 'list';
  /** 일과 담당의 손이 필요한 건수. 승인, 나이스 입력, 게시 셋을 합친다. */
  const waiting = dashboard.pendingCases + dashboard.neisTasks + dashboard.publicationTasks;
  return (
    <main id="main-content" tabIndex={-1} className="ops-command-center" data-ops-command-center data-ops-step={mobileStep}>
      <header className="ops-command-heading">
        <div>
          <span className="eyebrow">일과 담당</span>
          {/*
            * 제목이 물음에 답한다. 앞서는 "지금 결정해야 할 변경"이라는 표어였고 그 아래
            * 화면을 설명하는 부제목이 있었다. 일과 담당이 이 화면을 여는 이유는 하나다.
            * 내 손이 필요한 것이 몇 건인가.
            */}
          <h2>{waiting > 0 ? <>처리할 일 <span className="num">{waiting}</span>건</> : '처리할 일 없음'}</h2>
        </div>
        <DemoScenarioPicker state={scenarioState} onOpenScenario={onOpenScenario} />
      </header>

      {/*
        * 값이 0인 지표는 조용히 둔다.
        *
        * 앞서는 여섯을 똑같은 크기로 세웠고 대개 다섯이 0이었다. 0을 큰 숫자로 여섯 번
        * 보여 주면 1인 하나가 묻힌다. 셀 것이 있는 것을 앞에 두고, 0은 뒤에서 흐리게 둔다.
        */}
      <dl className="ops-metrics" aria-label="변경 관제 지표">
        {[...metrics].sort((left, right) =>
          (dashboard[right.key] > 0 ? 1 : 0) - (dashboard[left.key] > 0 ? 1 : 0),
        ).map(({ key, label }) => (
          <div key={key} data-ops-metric={key} className={dashboard[key] > 0 ? 'on' : ''}>
            <dt>{label}</dt><dd className="num">{dashboard[key]}</dd>
          </div>
        ))}
      </dl>

      <div className="ops-command-regions">
        <section className="ops-priority-region" aria-labelledby="ops-priority-title">
          <header><span className="eyebrow">사건 목록</span><h3 id="ops-priority-title">우선순위</h3></header>
          <ol>
            {cases.map((item) => (
              <li key={item.caseId}>
                <button
                  className={selectedCaseId === item.caseId ? 'selected' : ''}
                  aria-current={selectedCaseId === item.caseId ? 'true' : undefined}
                  onClick={() => onSelectCase(item.caseId)}
                >
                  <span className={'ops-priority-dot ' + item.priority} aria-hidden="true" />
                  <span><b>{item.requesterLabel}</b><small>{item.fromDate} · {item.affectedLessonCount}개 수업 / {item.solvedLessonCount}개 해결</small></span>
                  <em>{item.priorityReason}</em>
                </button>
              </li>
            ))}
            {cases.length === 0 && <li className="ops-empty">지금 관제할 변경 사건이 없습니다.</li>}
          </ol>
        </section>

        <section className="ops-timeline-region" aria-labelledby="ops-timeline-title">
          <header><span className="eyebrow">{dashboard.today}</span><h3 id="ops-timeline-title">오늘 교시 흐름</h3></header>
          {/*
            * 이름과 값이 짝인데 중간점으로 죽 이어 붙여 두었다. 짝을 짝으로 세운다.
            *
            * 무엇을 보고 있는지(출처)와 온전한지(완전성)는 지우면 안 된다. 예시 자료를
            * 실제 학교 자료로 착각하고 결재하면 안 되고, 자료가 덜 왔는데 승인해도 안 된다.
            */}
          <dl className="ops-source-health" aria-label="시간표 자료 상태">
            <div><dt>출처</dt><dd>{SOURCE_LABEL[dashboard.sourceHealth.source ?? 'none']}</dd></div>
            <div className={dashboard.sourceHealth.complete ? '' : 'mark'}>
              <dt>자료</dt><dd>{dashboard.sourceHealth.complete ? '완전' : '불완전'}</dd>
            </div>
            <div><dt>수업</dt><dd className="num">{dashboard.sourceHealth.lessonCount}</dd></div>
            {dashboard.sourceHealth.unassignedLessons > 0 && (
              <div className="mark">
                <dt>담당 미확정</dt><dd className="num">{dashboard.sourceHealth.unassignedLessons}</dd>
              </div>
            )}
          </dl>
          <ol className="ops-period-timeline" aria-label="오늘 변경 교시">
            {timeline.map((marker) => (
              <li key={marker.id} className={marker.state}>
                <span>{marker.period}교시</span>
                <button onClick={() => onSelectCase(marker.caseId)}>
                  <b>{marker.stateLabel}</b>
                  <small>{marker.affectedTeacherCount}명 교사 · {marker.affectedClassCount}개 학급</small>
                </button>
              </li>
            ))}
            {timeline.length === 0 && <li className="ops-empty">오늘 표시할 변경 교시가 없습니다.</li>}
          </ol>
        </section>

        <aside className="ops-case-region" aria-label="선택 사건과 행정 마감">
          <div className="ops-case-panel">{detail}</div>
          <section className="ops-administration-step" aria-labelledby="ops-admin-title">
            <h3 id="ops-admin-title" className="visually-hidden">행정 마감과 게시</h3>
            {administration ?? (
              <>
                <button className="btn ghost ops-mobile-back" onClick={onBackToList}>← 사건 목록으로</button>
                <span className="eyebrow">행정 마감</span>
                <p>나이스 입력 {dashboard.neisTasks}건, 학급 게시 확인 {dashboard.publicationTasks}건이 남았습니다.</p>
                <button className="btn" onClick={onReturnToCase}>사건 상세로 돌아가기</button>
              </>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
