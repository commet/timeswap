'use client';

import { useMemo, useState } from 'react';
import type { Candidate, ScheduleConfig } from '@timeswap/engine';
import { slotName } from '@timeswap/engine';
import type { ChangeRequest, ChecklistKey } from '../lib/requests';
import { requestStatusLabel } from '../lib/requests';

export function OpsInbox({
  requests,
  cfg,
  onApprove,
  onReject,
  onChecklist,
  onPublish,
  onCopyNeisList,
  onCopyNotice,
  onPrint,
  onSelectCandidate,
}: {
  requests: ChangeRequest[];
  cfg: ScheduleConfig;
  onApprove: (id: string) => void;
  onReject: (id: string, note: string) => void;
  onChecklist: (id: string, key: ChecklistKey, checked: boolean) => void;
  onPublish: (id: string) => void;
  onCopyNeisList: (id: string) => void;
  onCopyNotice: (id: string) => void;
  onPrint: (id: string) => void;
  onSelectCandidate: (id: string, candidate: Candidate) => void;
}) {
  const [filter, setFilter] = useState<'all' | ChangeRequest['status']>('all');
  const [selectedId, setSelectedId] = useState<string | null>(requests[0]?.id ?? null);
  const [rejectNote, setRejectNote] = useState('');
  const shown = useMemo(
    () => requests.filter((request) => filter === 'all' || request.status === filter),
    [requests, filter],
  );
  const selected = shown.find((request) => request.id === selectedId) ?? shown[0] ?? null;

  return (
    <main className="ops-work">
      <section className="ops-inbox">
        <header className="ops-heading">
          <div>
            <span className="eyebrow">일과 담당</span>
            <h1>변경 요청함</h1>
            <p>검토에서 공지까지, 남은 일이 보이도록 정리했습니다.</p>
          </div>
          <div className="ops-count">
            <b>{requests.filter((request) => request.status === 'pending').length}</b>
            <span>검토 대기</span>
          </div>
        </header>
        <div className="ops-filters" role="group" aria-label="요청 상태 필터">
          {([
            ['all', '전체'],
            ['pending', '검토 중'],
            ['approved', '승인'],
            ['published', '게시 완료'],
            ['rejected', '반려'],
          ] as const).map(([value, label]) => (
            <button key={value} className={filter === value ? 'on' : ''} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="inbox-list">
          {shown.length === 0 ? (
            <p className="ops-empty">이 상태의 요청이 없습니다.</p>
          ) : shown.map((request) => (
            <button
              key={request.id}
              className={selected?.id === request.id ? 'selected' : ''}
              onClick={() => setSelectedId(request.id)}
            >
              <time>{request.date}</time>
              <span><b>{request.teacher}</b><small>{request.target.klass} {request.target.subject}</small></span>
              <em className={'status-pill ' + request.status}>{requestStatusLabel(request.status)}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="ops-detail" aria-live="polite">
        {!selected ? (
          <div className="ops-empty detail-empty">
            <b>검토할 요청이 없습니다</b><span>교사가 요청을 보내면 여기에 표시됩니다.</span>
          </div>
        ) : (
          <>
            <header>
              <div>
                <span className="eyebrow">{selected.date} · {slotName(selected.target.slot, cfg)}</span>
                <h2 id="ops-detail-title" tabIndex={-1}>{selected.teacher} 선생님 · {selected.target.klass} {selected.target.subject}</h2>
              </div>
              <strong className={'status-pill ' + selected.status}>{requestStatusLabel(selected.status)}</strong>
            </header>
            <div className="ops-route">
              <span>{selected.kind === 'cover' ? '선택한 보강 교사' : '선택한 방법'}</span>
              <b>{selected.candidate.title}</b>
              <small>
                {selected.kind === 'cover'
                  ? '보강 1시간 · ' + selected.reason
                  : (selected.candidate.unitCount ?? selected.candidate.changes.length) + '개 수업 변경 · ' + selected.reason}
              </small>
              {selected.note && <p>{selected.note}</p>}
            </div>
            {selected.status === 'pending' && selected.kind === 'change' && (selected.alternatives?.length ?? 0) > 1 && (
              <label className="ops-alternative">
                <span>승인할 교체안</span>
                <select
                  className="select"
                  aria-label="승인할 교체안"
                  value={selected.alternatives?.findIndex((candidate) => candidate.title === selected.candidate.title) ?? 0}
                  onChange={(event) => {
                    const candidate = selected.alternatives?.[Number(event.target.value)];
                    if (candidate) onSelectCandidate(selected.id, candidate);
                  }}
                >
                  {selected.alternatives?.map((candidate, index) => (
                    <option key={candidate.type + candidate.title + index} value={index}>
                      {index + 1}. {candidate.title}
                    </option>
                  ))}
                </select>
                <small>교사가 고른 안이 기본입니다. 승인 전에 다른 성립안을 선택할 수 있습니다.</small>
              </label>
            )}
            {selected.kind === 'cover' && selected.cover ? (
              <div className="ops-cover-facts">
                <span>그날 수업 {selected.cover.dayLessons}시간</span>
                <span>최근 협조 {selected.cover.recentBurden}회</span>
                <span>{selected.cover.sameSubject ? '같은 과목 담당' : '다른 과목 담당'}</span>
              </div>
            ) : (
              <ol className="ops-changes">
                {selected.candidate.changes.map((change, index) => (
                  <li key={[change.from.teacher, change.from.slot, index].join('-')}>
                    <span>{index + 1}</span>
                    <div><b>{change.from.teacher}</b><small>{change.from.klass} {change.from.subject}</small></div>
                    <em>{slotName(change.from.slot, cfg)} → {slotName(change.toSlot, cfg)}</em>
                  </li>
                ))}
              </ol>
            )}

            {selected.status === 'pending' && (
              <div className="ops-decision">
                <button className="btn primary" onClick={() => onApprove(selected.id)}>이 안으로 승인</button>
                <input
                  className="input"
                  value={rejectNote}
                  placeholder="반려할 때 조정이 필요한 이유"
                  onChange={(event) => setRejectNote(event.target.value)}
                />
                <button
                  className="btn"
                  disabled={!rejectNote.trim()}
                  onClick={() => onReject(selected.id, rejectNote)}
                >
                  반려
                </button>
              </div>
            )}

            {(selected.status === 'approved' || selected.status === 'published') && (
              <div className="admin-checklist">
                <div>
                  <span className="eyebrow">행정 마무리</span>
                  <h3 id="admin-checklist-title" tabIndex={-1}>세 단계가 끝나야 게시할 수 있습니다</h3>
                </div>
                {([
                  ['neis', '나이스 변경 입력', '입력 목록 복사', () => onCopyNeisList(selected.id)],
                  ['notice', '교사·학급 공지 확인', '공지 복사', () => onCopyNotice(selected.id)],
                  ['document', '결재 문서 저장', '계획서 인쇄', () => onPrint(selected.id)],
                ] as Array<[ChecklistKey, string, string, () => void]>).map(([key, label, action, run]) => (
                  <div className="admin-task" key={key}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.checklist[key]}
                        disabled={selected.status === 'published'}
                        onChange={(event) => onChecklist(selected.id, key, event.target.checked)}
                      />
                      <span>{label}</span>
                    </label>
                    <button className="btn ghost" onClick={run}>{action}</button>
                  </div>
                ))}
                {selected.status === 'approved' && (
                  <button
                    className="btn primary publish"
                    disabled={!Object.values(selected.checklist).every(Boolean)}
                    onClick={() => onPublish(selected.id)}
                  >
                    변경 시간표 게시
                  </button>
                )}
              </div>
            )}
            {selected.adminNote && <p className="admin-note">담당자 메모: {selected.adminNote}</p>}
          </>
        )}
      </section>
    </main>
  );
}
