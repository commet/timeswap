'use client';

import { useEffect, useState } from 'react';
import { slotName, type ScheduleConfig } from '@timeswap/engine';
import type { AppliedEntry } from '../lib/app';

const TYPE_LABEL: Record<AppliedEntry['type'], string> = {
  move: '빈 시간으로 이동',
  swap2: '맞바꾸기',
  cycle3: '연쇄 교체',
  보강: '보강',
};

/**
 * 인쇄할 때만 나오는 수업 교체 계획서(A4).
 *
 * 결재선을 타는 문서라 화면 카드와 다른 규칙을 따른다.
 * 변경 내용은 줄글이 아니라 칸을 나눈 표로 적는다. 결재하는 분이 훑어보는 문서이고,
 * 나이스에 옮겨 적는 사람도 이 표를 그대로 보고 친다.
 * 자리를 내어 준 교사는 아래에 따로 모아 확인란을 둔다.
 */
export function Sheet({
  schoolName,
  cfg,
  entries,
  teacher,
  reason,
}: {
  schoolName: string;
  cfg: ScheduleConfig;
  entries: AppliedEntry[];
  /** 결강 당사자 */
  teacher: string;
  /** 결강 사유 */
  reason: string;
}) {
  const [today, setToday] = useState('');
  useEffect(() => {
    const d = new Date();
    setToday(`${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`);
  }, []);

  // 자리를 내어 준 교사. 결강 당사자는 뺀다.
  const helpers = [
    ...new Set(
      [
        ...entries.flatMap((e) => e.changes.map((c) => c.from.teacher)),
        ...entries.flatMap((e) => (e.cover ? [e.cover.teacher] : [])),
      ].filter((t) => t !== teacher),
    ),
  ].sort((a, b) => a.localeCompare(b, 'ko'));

  const rows = entries.flatMap((e, i) => {
    // 보강은 자리가 아니라 사람이 바뀐다. 변경 전후 칸에 그 사실을 그대로 적는다.
    if (e.cover) {
      return [
        {
          key: `${e.id}-c`,
          no: String(i + 1),
          kind: TYPE_LABEL[e.type],
          klass: e.cover.klass,
          subject: e.cover.subject,
          teacher: e.cover.absent,
          before: `${slotName(e.cover.slot, cfg)} (${e.cover.absent})`,
          after: `${slotName(e.cover.slot, cfg)} (${e.cover.teacher})`,
          first: true,
        },
      ];
    }
    return e.changes.map((c, j) => ({
      key: `${e.id}-${j}`,
      no: j === 0 ? String(i + 1) : '',
      kind: j === 0 ? TYPE_LABEL[e.type] : '',
      klass: c.from.klass,
      subject: c.from.subject,
      teacher: c.from.teacher,
      before: slotName(c.from.slot, cfg),
      after: slotName(c.toSlot, cfg),
      first: j === 0,
    }));
  });

  return (
    <div className="sheet" aria-hidden>
      <div className="sheet-approve">
        <table>
          <tbody>
            <tr>
              <td className="sheet-approve-label">담당</td>
              <td className="sheet-approve-label">부장</td>
              <td className="sheet-approve-label">교감</td>
              <td className="sheet-approve-label">교장</td>
            </tr>
            <tr>
              <td className="sheet-approve-box" />
              <td className="sheet-approve-box" />
              <td className="sheet-approve-box" />
              <td className="sheet-approve-box" />
            </tr>
          </tbody>
        </table>
      </div>
      <h1>수업 교체 계획서</h1>

      <table className="sheet-head">
        <tbody>
          <tr>
            <th>학교</th>
            <td>{schoolName}</td>
            <th>작성일</th>
            <td>{today}</td>
          </tr>
          <tr>
            <th>신청 교사</th>
            <td>{teacher}</td>
            <th>사유</th>
            <td>{reason}</td>
          </tr>
        </tbody>
      </table>

      <table className="sheet-table">
        <thead>
          <tr>
            <th style={{ width: '7%' }}>순번</th>
            <th style={{ width: '15%' }}>구분</th>
            <th style={{ width: '11%' }}>학급</th>
            <th style={{ width: '15%' }}>과목</th>
            <th style={{ width: '14%' }}>담당 교사</th>
            <th style={{ width: '19%' }}>변경 전</th>
            <th style={{ width: '19%' }}>변경 후</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.first ? 'sheet-first' : ''}>
              <td className="c">{r.no}</td>
              <td className="c">{r.kind}</td>
              <td className="c">{r.klass}</td>
              <td>{r.subject}</td>
              <td className="c">{r.teacher}</td>
              <td className="c">{r.before}</td>
              <td className="c">{r.after}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {helpers.length > 0 && (
        <table className="sheet-sign">
          <thead>
            <tr>
              <th colSpan={helpers.length}>협조 교사 확인</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {helpers.map((h) => (
                <td key={h} className="sheet-sign-name">
                  {h}
                </td>
              ))}
            </tr>
            <tr>
              {helpers.map((h) => (
                <td key={`${h}-box`} className="sheet-sign-box" />
              ))}
            </tr>
          </tbody>
        </table>
      )}

      <p className="sheet-note">위와 같이 수업을 교체하고자 하오니 결재하여 주시기 바랍니다.</p>
      <p className="sheet-foot">
        학급 시간표의 빈 시간이 늘지 않고, 담당 교사가 같은 교시에 겹치지 않음을 확인하였습니다.
      </p>
    </div>
  );
}
