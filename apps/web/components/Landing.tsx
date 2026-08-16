'use client';

import { useRef, useState } from 'react';

export function Landing({
  onSample,
  onFile,
  busy,
}: {
  onSample: () => void;
  onFile: (file: File) => void;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div className="landing">
      <div className="landing-card">
        <h1>
          수업을 바꿔야 할 때,
          <br />
          경우의 수는 <em>타임스왑</em>이 셉니다
        </h1>
        <p className="lede">
          시간표를 불러오고, 못 들어가는 교시를 짚으십시오. 맞교환, 3자 순환, 빈 교시
          이동까지 성립하는 안을 전부 찾아 근거와 함께 제시합니다.
        </p>
        <div
          className={`dropzone${over ? ' on' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
        >
          <p>컴시간 뷰어 JSON 파일을 끌어다 놓거나, 샘플 학교로 바로 체험하십시오.</p>
          <div className="actions">
            <button className="btn primary" onClick={onSample} disabled={busy}>
              {busy ? '불러오는 중' : '샘플 학교로 체험'}
            </button>
            <button className="btn" onClick={() => inputRef.current?.click()} disabled={busy}>
              JSON 파일 선택
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        <p className="privacy">
          시간표는 이 브라우저 안에만 저장됩니다. 서버로 보내지 않습니다.
        </p>
      </div>
    </div>
  );
}
