'use client';

import { useEffect, useState } from 'react';
import { slotName, type ScheduleConfig } from '@timeswap/engine';
import type { AppliedEntry } from '../lib/app';

const TYPE_LABEL: Record<AppliedEntry['type'], string> = {
  move: '빈 시간으로 이동',
  swap2: '맞바꾸기',
  cycle3: '연쇄 교체',
};

/** 인쇄 시에만 보이는 수업 교체 계획서(A4). 오늘의 변경 장부를 그대로 옮긴다. */
export function Sheet({
  schoolName,
  cfg,
  entries,
}: {
  schoolName: string;
  cfg: ScheduleConfig;
  entries: AppliedEntry[];
}) {
  const [today, setToday] = useState('');
  useEffect(() => {
    const d = new Date();
    setToday(`${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`);
  }, []);

  return (
    <div className="sheet" aria-hidden>
      <div className="sheet-approve">
        <table>
          <tbody>
            <tr>
              <td className="sheet-approve-label">담당</td>
              <td className="sheet-approve-label">교감</td>
              <td className="sheet-approve-label">교장</td>
            </tr>
            <tr>
              <td className="sheet-approve-box" />
              <td className="sheet-approve-box" />
              <td className="sheet-approve-box" />
            </tr>
          </tbody>
        </table>
      </div>
      <h1>수업 교체 계획서</h1>
      <p className="sheet-meta">
        {schoolName} | 작성일 {today}
      </p>
      <table className="sheet-table">
        <thead>
          <tr>
            <th style={{ width: '8%' }}>순번</th>
            <th style={{ width: '16%' }}>구분</th>
            <th>변경 내용</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={e.id}>
              <td className="c">{i + 1}</td>
              <td className="c">{TYPE_LABEL[e.type]}</td>
              <td>
                {e.changes.map((c, j) => (
                  <div key={j}>
                    {c.from.klass} {c.from.subject}({c.from.teacher}): {slotName(c.from.slot, cfg)}{' '}
                    에서 {slotName(c.toSlot, cfg)}로
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sheet-note">
        위와 같이 수업을 교체하고자 하니 결재하여 주시기 바랍니다.
      </p>
    </div>
  );
}
