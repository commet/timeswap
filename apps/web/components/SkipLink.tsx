'use client';

/**
 * 앵커만으로는 초점이 옮겨지지 않는다. 브라우저는 스크롤만 옮기고 다음 Tab 의
 * 출발점도 항상 따라오지는 않아, 키보드로 온 사람이 머리말로 되돌아간다.
 * 그래서 본문 랜드마크에 초점을 직접 준다.
 */
export function SkipLink() {
  return (
    <a
      className="skip-link"
      href="#main-content"
      onClick={(event) => {
        const main = document.getElementById('main-content');
        if (!main) return;
        event.preventDefault();
        main.focus();
        main.scrollIntoView({ block: 'start' });
      }}
    >본문으로 건너뛰기</a>
  );
}
