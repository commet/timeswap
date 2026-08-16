'use client';

import { slotName, slotOf, type Assignment, type Candidate, type ScheduleConfig } from '@timeswap/engine';
import { subjectHue } from '../lib/app';
import type { CSSProperties } from 'react';

interface Props {
  cfg: ScheduleConfig;
  mode: 'teacher' | 'klass';
  /** 교사 뷰에서는 교사 이름, 학급 뷰에서는 학급 이름 */
  owner: string;
  lessons: Assignment[];
  /** 결강 대기열. 첫 항목이 지금 처리 중인 결강이다. */
  absentSlots: number[];
  /** 현재 교사의 근무 불가 슬롯. 빈 교시를 눌러 잠근다. */
  lockedSlots: number[];
  /** 오늘 요일 열 강조 (0 = 월). 주말이면 null */
  todayIdx: number | null;
  preview: Candidate | null;
  onToggleSlot: (slot: number) => void;
  onToggleDay: (day: number) => void;
  onToggleLock: (slot: number) => void;
}

export function Grid({
  cfg,
  mode,
  owner,
  lessons,
  absentSlots,
  lockedSlots,
  todayIdx,
  preview,
  onToggleSlot,
  onToggleDay,
  onToggleLock,
}: Props) {
  const bySlot = new Map<number, Assignment>();
  for (const a of lessons) bySlot.set(a.slot, a);

  const teacherMode = mode === 'teacher';
  const active = teacherMode ? (absentSlots[0] ?? null) : null;
  const queued = teacherMode ? new Set(absentSlots) : new Set<number>();
  const locked = teacherMode ? new Set(lockedSlots) : new Set<number>();
  const own = teacherMode ? preview?.changes.find((c) => c.from.teacher === owner) : undefined;
  const incoming = teacherMode
    ? preview?.changes.find((c) => c.from.teacher !== owner && c.toSlot === active)
    : undefined;

  const cols = `40px repeat(${cfg.days}, minmax(92px, 1fr))`;

  return (
    <section className="card grid-wrap" aria-label="주간 시간표">
      <div className="card-head">
        <h2>{teacherMode ? `${owner} 선생님의 한 주` : `${owner} 반의 한 주`}</h2>
        <span className="sub">
          {!teacherMode
            ? '변경이 반영된 학급 시간표'
            : active === null
              ? '바꿀 수업을 선택하십시오. 요일 이름을 누르면 그날 전체가 선택됩니다'
              : `${slotName(active, cfg)} 수업의 교체 방법`}
        </span>
      </div>
      <div className="grid-scroll">
        <div className="tt-grid" style={{ gridTemplateColumns: cols }}>
          <div className="tt-head corner" aria-hidden />
          {cfg.dayNames.map((d, di) =>
            teacherMode ? (
              <button
                key={d}
                className={`tt-head day-btn${todayIdx === di ? ' today' : ''}`}
                title="그날 수업 전체 선택"
                onClick={() => onToggleDay(di)}
              >
                {d}
              </button>
            ) : (
              <div key={d} className={`tt-head${todayIdx === di ? ' today' : ''}`}>
                {d}
              </div>
            ),
          )}
          {Array.from({ length: cfg.periods }, (_, p) => (
            <Row
              key={p}
              p={p}
              cfg={cfg}
              teacherMode={teacherMode}
              bySlot={bySlot}
              active={active}
              queued={queued}
              locked={locked}
              todayIdx={todayIdx}
              own={own}
              incoming={incoming}
              onToggleSlot={onToggleSlot}
              onToggleLock={onToggleLock}
            />
          ))}
        </div>
      </div>
      {teacherMode && (
        <div className="grid-legend">
          <span>
            <i style={{ background: 'var(--warn)' }} /> 선택한 수업
          </span>
          <span>
            <i style={{ background: 'var(--accent)' }} /> 이동할 자리
          </span>
          <span>
            <i style={{ background: 'var(--accent-soft)', outline: '1.5px dashed var(--accent)' }} /> 들어오는 수업
          </span>
          <span>
            <i style={{ background: 'var(--surface-2)', outline: '1.5px dashed var(--muted)' }} /> 수업 불가 시간
          </span>
        </div>
      )}
    </section>
  );
}

function Row({
  p,
  cfg,
  teacherMode,
  bySlot,
  active,
  queued,
  locked,
  todayIdx,
  own,
  incoming,
  onToggleSlot,
  onToggleLock,
}: {
  p: number;
  cfg: ScheduleConfig;
  teacherMode: boolean;
  bySlot: Map<number, Assignment>;
  active: number | null;
  queued: Set<number>;
  locked: Set<number>;
  todayIdx: number | null;
  own?: { from: Assignment; toSlot: number };
  incoming?: { from: Assignment; toSlot: number };
  onToggleSlot: (slot: number) => void;
  onToggleLock: (slot: number) => void;
}) {
  return (
    <>
      <div className="tt-period">{p + 1}</div>
      {Array.from({ length: cfg.days }, (_, d) => {
        const s = slotOf(d, p, cfg);
        const a = bySlot.get(s);
        const isActive = active === s;
        const isQueued = queued.has(s) && !isActive;
        const today = todayIdx === d ? ' today-col' : '';
        const leaving = own !== undefined && own.from.slot === s && own.toSlot !== s;
        const arriving = own !== undefined && own.toSlot === s;
        const showIncoming = isActive && incoming !== undefined;

        if (!a && arriving && own) {
          return (
            <div key={s} className={`cell lesson arriving${today}`} aria-label={`${slotName(s, cfg)}로 옮기기`}>
              <span className="k">{own.from.klass}</span>
              <span className="s">{own.from.subject} 이동</span>
            </div>
          );
        }
        if (!a) {
          if (!teacherMode) {
            return <div key={s} className={`cell empty${today}`} aria-label={`${slotName(s, cfg)} 공강`} />;
          }
          const isLocked = locked.has(s);
          return (
            <button
              key={s}
              className={`cell empty${isLocked ? ' locked' : ''}${today}`}
              title={
                isLocked
                  ? '수업 불가 시간입니다. 다시 누르면 해제됩니다'
                  : '회의나 출장 등으로 수업이 불가능한 시간으로 지정합니다'
              }
              aria-label={`${slotName(s, cfg)} ${isLocked ? '근무 불가' : '공강'}`}
              aria-pressed={isLocked}
              onClick={() => onToggleLock(s)}
            >
              {isLocked && <span className="lock-mark">불가</span>}
            </button>
          );
        }
        if (showIncoming && incoming) {
          return (
            <div key={s} className={`cell incoming${today}`} aria-label="이 시간에 들어올 수업">
              <span className="k">{incoming.from.teacher}</span>
              <span className="s">
                {incoming.from.subject}
              </span>
            </div>
          );
        }
        const cls = ['cell', 'lesson'];
        if (isActive) cls.push('absent');
        if (isQueued) cls.push('absent', 'queued');
        if (leaving) cls.push('leaving');
        const style = { '--hue': subjectHue(a.subject) } as CSSProperties;
        if (!teacherMode) {
          return (
            <div
              key={s}
              className={`${cls.join(' ')}${today}`}
              style={style}
              aria-label={`${slotName(s, cfg)} ${a.subject} ${a.teacher}`}
            >
              <span className="k">{a.subject}</span>
              <span className="s">
                {a.teacher}
                {a.group && <span className="gmark">이동</span>}
              </span>
            </div>
          );
        }
        return (
          <button
            key={s}
            className={`${cls.join(' ')}${today}`}
            style={style}
            title={a.group ? '이동수업입니다. 묶음 전체가 함께 움직입니다' : undefined}
            aria-label={`${slotName(s, cfg)} ${a.klass} ${a.subject}`}
            aria-pressed={isActive || isQueued}
            onClick={() => onToggleSlot(s)}
          >
            {isActive && <span className="badge-absent">선택</span>}
            {isQueued && <span className="badge-absent queued">대기</span>}
            <span className="k">{a.klass}</span>
            <span className="s">
              {a.subject}
              {a.group && <span className="gmark">이동</span>}
            </span>
          </button>
        );
      })}
    </>
  );
}
