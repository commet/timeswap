'use client';

import { slotName, slotOf, type Assignment, type Candidate, type ScheduleConfig } from '@timeswap/engine';
import { subjectHue } from '../lib/app';
import type { CSSProperties } from 'react';

interface Props {
  cfg: ScheduleConfig;
  teacher: string;
  lessons: Assignment[];
  absentSlot: number | null;
  preview: Candidate | null;
  onSelect: (slot: number | null) => void;
}

export function Grid({ cfg, teacher, lessons, absentSlot, preview, onSelect }: Props) {
  const bySlot = new Map<number, Assignment>();
  for (const a of lessons) bySlot.set(a.slot, a);

  const own = preview?.changes.find((c) => c.from.teacher === teacher);
  const incoming = preview?.changes.find(
    (c) => c.from.teacher !== teacher && c.toSlot === absentSlot,
  );

  const cols = `44px repeat(${cfg.days}, minmax(96px, 1fr))`;

  return (
    <section className="card grid-wrap" aria-label="주간 시간표">
      <div className="card-head">
        <h2>{teacher} 선생님의 한 주</h2>
        <span className="sub">
          {absentSlot === null
            ? '못 들어가는 수업 칸을 누르십시오'
            : `${slotName(absentSlot, cfg)} 결강을 살피는 중`}
        </span>
      </div>
      <div className="grid-scroll">
        <div className="tt-grid" style={{ gridTemplateColumns: cols }}>
          <div className="tt-head" aria-hidden />
          {cfg.dayNames.map((d) => (
            <div key={d} className="tt-head">
              {d}
            </div>
          ))}
          {Array.from({ length: cfg.periods }, (_, p) => (
            <Row
              key={p}
              p={p}
              cfg={cfg}
              bySlot={bySlot}
              absentSlot={absentSlot}
              own={own}
              incoming={incoming}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
      <div className="grid-legend">
        <span>
          <i style={{ background: 'var(--warn)' }} /> 결강 지정
        </span>
        <span>
          <i style={{ background: 'var(--accent)' }} /> 옮겨 갈 자리
        </span>
        <span>
          <i style={{ background: 'var(--accent-soft)', outline: '1.5px dashed var(--accent)' }} /> 들어올 수업
        </span>
      </div>
    </section>
  );
}

function Row({
  p,
  cfg,
  bySlot,
  absentSlot,
  own,
  incoming,
  onSelect,
}: {
  p: number;
  cfg: ScheduleConfig;
  bySlot: Map<number, Assignment>;
  absentSlot: number | null;
  own?: { from: Assignment; toSlot: number };
  incoming?: { from: Assignment; toSlot: number };
  onSelect: (slot: number | null) => void;
}) {
  return (
    <>
      <div className="tt-period">{p + 1}</div>
      {Array.from({ length: cfg.days }, (_, d) => {
        const s = slotOf(d, p, cfg);
        const a = bySlot.get(s);
        const isAbsent = absentSlot === s;
        const leaving = own !== undefined && own.from.slot === s && own.toSlot !== s;
        const arriving = own !== undefined && own.toSlot === s;
        const showIncoming = isAbsent && incoming !== undefined;

        if (!a && arriving && own) {
          return (
            <div key={s} className="cell lesson arriving" aria-label={`${slotName(s, cfg)}로 이동`}>
              <span className="k">{own.from.klass}</span>
              <span className="s">{own.from.subject} 이동</span>
            </div>
          );
        }
        if (!a) {
          return <div key={s} className="cell empty" aria-label={`${slotName(s, cfg)} 공강`} />;
        }
        if (showIncoming && incoming) {
          return (
            <div key={s} className="cell incoming" aria-label="이 시간에 들어올 수업">
              <span className="k">{incoming.from.teacher}</span>
              <span className="s">
                {incoming.from.subject} 수업이 들어옵니다
              </span>
            </div>
          );
        }
        const cls = ['cell', 'lesson'];
        if (isAbsent) cls.push('absent');
        if (leaving) cls.push('leaving');
        const style = { '--hue': subjectHue(a.subject) } as CSSProperties;
        return (
          <button
            key={s}
            className={cls.join(' ')}
            style={style}
            title={a.group ? '분반, 동시수업 묶음' : undefined}
            aria-label={`${slotName(s, cfg)} ${a.klass} ${a.subject}`}
            aria-pressed={isAbsent}
            onClick={() => onSelect(isAbsent ? null : s)}
          >
            {isAbsent && <span className="badge-absent">결강</span>}
            <span className="k">{a.klass}</span>
            <span className="s">
              {a.subject}
              {a.group && <span className="gmark">동시</span>}
            </span>
          </button>
        );
      })}
    </>
  );
}
