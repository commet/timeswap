'use client';

import { publishedTimeLabel } from '../lib/publication';

export type ChangePulseDestination = {
  id: string;
  label: string;
  detail: string;
};

export type ChangePulseProps = {
  destinations: ChangePulseDestination[];
  publishedAt?: string;
};

/**
 * Publication is the moment one decision becomes three timetables.  The rail
 * shows that propagation, and the live region says the same thing in words so
 * the animation is never the only carrier of the fact.
 */
export function ChangePulse({ destinations, publishedAt }: ChangePulseProps) {
  if (destinations.length === 0) return null;

  return (
    <section className="change-pulse" aria-labelledby="change-pulse-title" data-change-pulse>
      <header>
        <span className="eyebrow">게시 전파</span>
        <h3 id="change-pulse-title">이 변경이 닿은 곳</h3>
      </header>
      <ol className="change-pulse-rail">
        {destinations.map((destination, index) => (
          <li key={destination.id} style={{ '--pulse-order': index } as React.CSSProperties}>
            <span className="change-pulse-dot" aria-hidden="true" />
            <b>{destination.label}</b>
            <small>{destination.detail}</small>
          </li>
        ))}
      </ol>
      <p className="change-pulse-status" role="status">
        {`게시를 마쳤습니다. ${destinations.map((destination) => destination.label).join(', ')}에 반영했습니다.`}
        {publishedAt ? ` 게시 시각 ${publishedTimeLabel(publishedAt)}.` : ''}
      </p>
    </section>
  );
}
