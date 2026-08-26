'use client';

import type { CrossingView } from '../lib/resolution';

/**
 * 교차 확인.
 *
 * 그날 그 교사의 자리와 그 학급의 자리를 나란히 그리고, 가려는 교시에 세로로 표시를 한다.
 * 두 줄 모두 그 칸이 비어 있으면 갈 수 있다는 뜻이고, 그것이 이 도구가 찾는 전부다.
 *
 * 앞서는 같은 사실을 문장 셋으로 적었다. 읽고 머릿속에서 표를 그려야 맞는지 알 수 있었다.
 */
export function CrossingCheck({ views }: { views: CrossingView[] }) {
  if (views.length === 0) return null;
  return (
    <div className="crossing" data-crossing>
      {views.map((view) => (
        <figure key={view.changeId} className="crossing-figure">
          <figcaption>
            <b>{view.subject}</b>
            <span className="num">{view.date}</span>
            <span>
              <span className="num">{view.target}</span>교시로
            </span>
          </figcaption>
          <div className="crossing-grid" style={{ '--periods': view.periods } as React.CSSProperties}>
            <span className="crossing-corner" aria-hidden />
            {Array.from({ length: view.periods }, (_, index) => (
              <span
                key={`head-${index + 1}`}
                className={`crossing-head num ${index + 1 === view.target ? 'target' : ''}`}
                aria-hidden
              >
                {index + 1}
              </span>
            ))}
            {view.tracks.map((track) => (
              <div key={`${track.kind}-${track.label}`} className="crossing-track" role="group" aria-label={track.label}>
                <span className="crossing-label">{track.label}</span>
                {Array.from({ length: view.periods }, (_, index) => {
                  const period = index + 1;
                  const busy = track.busy.includes(period);
                  const target = period === view.target;
                  return (
                    <span
                      key={period}
                      className={`crossing-cell ${busy ? 'busy' : 'free'} ${target ? 'target' : ''}`}
                    >
                      <span className="visually-hidden">
                        {period}교시 {busy ? '수업 있음' : '비어 있음'}{target ? ', 여기로 옮깁니다' : ''}
                      </span>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </figure>
      ))}
    </div>
  );
}
