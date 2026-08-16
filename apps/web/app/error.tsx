'use client';

import { useEffect } from 'react';

/**
 * 화면이 통째로 죽었을 때 나오는 자리.
 *
 * 이것이 없으면 흰 화면만 남는다. 결강 처리를 하던 선생님은
 * 무슨 일이 났는지도, 방금까지 하던 작업이 남았는지도 알 수 없다.
 * 그래서 두 가지를 반드시 말한다. 자료는 그대로라는 것과 무엇을 누르면 되는지다.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    // 브라우저 콘솔에는 남겨 둔다. 밖으로 보내지는 않는다.
    // 시간표에는 학교와 교사 이름이 들어 있어 오류 보고에 실어 보낼 자료가 아니다.
  }, []);

  return (
    <div className="crash">
      <div className="crash-card">
        <h1>화면을 그리지 못했습니다</h1>
        <p>
          불러오신 시간표와 반영하신 변경은 이 기기에 그대로 있습니다. 아래 단추로 다시 여시면
          하시던 자리에서 이어집니다.
        </p>
        <div className="crash-actions">
          <button className="btn primary" onClick={reset}>
            다시 열기
          </button>
          <button className="btn" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </div>
        <p className="crash-hint">
          같은 일이 되풀이되면 시작 화면의 자료 지우기로 처음부터 다시 불러오십시오.
        </p>
      </div>
    </div>
  );
}
