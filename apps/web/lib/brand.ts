/**
 * 제품 이름은 여기 한 곳에서만 정한다.
 * 화면, 문서 제목, 안내문, 인쇄물이 모두 이 값을 읽으므로 이름을 바꿀 때 이 파일만 고치면 된다.
 *
 * "조율"을 고른 이유.
 *  - 짧다. 두 글자라 상단 로고, 인쇄물 머리글, 공유 카드 어디에도 들어간다.
 *  - 정확하다. 맞바꾸기가 아닌 경우(보강, 빈 시간 이동)까지 한 단어로 덮는다.
 *    "품앗이"는 서로 주고받을 때만 맞는 말이라 절반의 경우에 어긋났다.
 *  - 학교에서 쓰는 말이다. "시간표 조율", "일정 조율"은 공문에도 그대로 나온다.
 */
export const BRAND = '조율';

/** 이름만으로 무엇인지 모를 수 있어 문서 제목과 검색 결과에는 이 형태로 쓴다. */
export const BRAND_FULL = '조율 | 수업 교체 도우미';

/** 한 줄 소개. 검색 결과와 공유 카드에 쓴다. */
export const TAGLINE = '수업에 들어가지 못하게 됐을 때, 가능한 교체 방법을 모두 찾아 드립니다';

/** 앞말 받침에 따라 조사를 고른다. */
export function josa(word: string, pair: '이/가' | '을/를' | '와/과' | '은/는'): string {
  let final = -1;
  for (let i = word.length - 1; i >= 0; i--) {
    const c = word.charCodeAt(i);
    if (c >= 0xac00 && c <= 0xd7a3) {
      final = (c - 0xac00) % 28;
      break;
    }
  }
  const hasBatchim = final > 0;
  const [withBatchim, without] = pair.split('/') as [string, string];
  return hasBatchim ? withBatchim : without;
}
