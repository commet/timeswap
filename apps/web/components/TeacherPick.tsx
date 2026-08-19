'use client';

import { useMemo, useState } from 'react';

/**
 * 시간표를 처음 불러온 뒤 한 번만 나오는 화면.
 *
 * 이 단계가 없으면 도구가 수업이 가장 많은 교사를 임의로 골라 보여 준다.
 * 선생님은 남의 시간표를 마주하고 상단에서 자기 이름을 찾아야 한다.
 * 결강 처리를 하러 온 사람에게 시킬 일이 아니다.
 */
export function TeacherPick({
  schoolName,
  teachers,
  onPick,
}: {
  schoolName: string;
  teachers: Array<{ name: string; n: number }>;
  onPick: (name: string) => void;
}) {
  const [q, setQ] = useState('');

  const shown = useMemo(() => {
    const t = q.trim();
    return t === '' ? teachers : teachers.filter((x) => x.name.includes(t));
  }, [teachers, q]);

  return (
    <main id="main-content" tabIndex={-1} className="work single">
      <section className="card pick">
        <div className="card-head">
          <h2>선생님 성함을 선택하십시오</h2>
          <span className="sub">{schoolName} | 교사 {teachers.length}명</span>
        </div>
        <p className="pick-lede">
          선택하신 분의 시간표가 열립니다. 나중에 위쪽에서 언제든 바꾸실 수 있습니다.
        </p>
        <input
          className="input pick-search"
          placeholder="성함으로 찾기"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && shown.length === 1 && shown[0]) onPick(shown[0].name);
          }}
        />
        {shown.length === 0 ? (
          <p className="pick-empty">그 이름의 교사를 찾지 못했습니다.</p>
        ) : (
          <ul className="pick-list">
            {shown.map((t) => (
              <li key={t.name}>
                <button onClick={() => onPick(t.name)}>
                  <span className="pick-name">{t.name}</span>
                  <span className="pick-load">주 {t.n}시간</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
