# Task 11 report — 행정 마감과 하나의 게시된 사실

## Delivered

- `apps/web/lib/publication.ts` 를 만들어 계획서의 네 계약을 구현했다. `publishCase`,
  `buildNeisInputList`, `buildTeacherNotice`, `buildClassPublicationPreview`.
- 게시본 식별자와 감사 사건 식별자를 사건 id 와 시각에서 유도한다. 같은 게시를 두 번
  기록할 수 없고, 재시도는 조용히 중복되는 대신 감사 id 충돌로 막힌다.
- 게시는 승인 시점을 믿지 않는다. 행정 과업을 마친 뒤 활성 버전 기준으로 사건 전체를
  다시 검증하고, 미해결 항목, 낡은 버전, 충돌이 하나라도 있으면 거부한다.
- `apps/web/lib/publication-center.ts` 에 게시 단계 읽기 모델을 두었다. 화면의 게시
  단추는 `canPublish` 하나만 읽으므로 도메인이 거부할 게시를 화면이 권할 수 없다.
- `PublicationCenter`, `PublicClassTimetable`, `ChangePulse` 를 새로 만들었다.
- 승인과 게시를 분리해 표시한다. 승인은 완료, 게시는 대기로 각각 보여 준다.
- 학급 공개 시간표는 수업 사실과 게시 시각만 담는다. 부재 사유, 교사 식별자, 후보
  점수, 보강 부담, 감사 행위자는 투영 단계에서 들어가지 않는다.
- 이름이 없는 교사를 초대 식별자 그대로 문서에 찍지 않는다. `이름 확인 필요` 로 적는다.
- 게시 시각을 저장은 UTC 로, 화면은 보는 사람의 시간대로 분 단위까지만 보여 준다.

## 계획서와 다르게 한 것

- 계획서의 파일 지도는 네 계약을 `apps/web/lib/app.ts` 에 두는 것으로 읽힌다. `app.ts`
  는 아직 v0 화면이 쓰는 legacy 모듈이고 같은 이름의 `buildNotice`, `buildNeisList` 가
  이미 있다. 작업 3부터 10까지가 `case-service.ts`, `projections.ts`, `resolution.ts`,
  `ops-command-center.ts` 를 따로 둔 것과 같은 방식으로 `publication.ts` 를 새로 만들었다.

## 구현 중에 드러난 결함 세 가지

1. **승인해도 행정 과업이 생기지 않았다.** `createPrototypeAdminTasks` 가 도메인에는
   있었지만 어느 화면도 부르지 않았다. 승인한 사건이 할 일 없이 멈춰 있었다. 승인
   처리에서 같은 저장으로 과업을 만들도록 붙였다.
2. **게시 센터가 데스크톱에서 보이지 않았다.** `.ops-administration-step` 이 기본
   `display: none` 이고 759px 이하에서만 나타났다. 데스크톱에서도 `step=admin` 일 때
   사건 상세 자리를 대신 쓰도록 고쳤다.
3. **게시하는 순간 화면이 사라졌다.** 선택 사건을 관제 목록에서 찾고 있었는데 게시된
   사건은 그 목록에서 빠진다. 선택 판정을 실제 사건 존재 여부로 바꿨다.

## TDD record

먼저 실패하는 게시 규칙 시험을 썼다.

```text
npm run test -w web -- publication.test.ts
→ Test Files 1 failed (1) / Tests no tests
  (lib/publication 모듈이 없어 import 단계에서 실패)
```

구현 뒤 통과했다. 게시 12개, 게시 센터 읽기 모델 6개, 합계 18개다.

브라우저 관문도 먼저 실패했다.

```text
검증 결과: [ '유효한 사건을 승인하지 못함', '게시 전파 표시가 나타나지 않음' ]
```

첫 항목은 승인이 이제 행정 과업까지 만들면서 상태가 `admin_in_progress` 가 된 것이
원인이다. 시험 쪽 기대를 새 사실에 맞추고 과업 4건 생성을 함께 확인하도록 고쳤다.
둘째 항목이 위의 세 번째 결함을 드러냈다.

## 게시 경계 실측

같은 학급 URL 을 별도 페이지로 열어 게시 전후를 잰다. 화면에 남은 메모리 상태로
통과하는 일이 없도록 판정은 항상 새로 연 페이지가 한다.

- 게시 전: 학급 시간표에 변경 0건, `연수·출장` 과 `teacher:seo-jun` 노출 없음.
- 게시 후: 변경 2건과 변경 표시, 마지막 게시 시각 표시, 내부 정보 노출 없음.
- 맞교환 두 수업이 하나의 게시본에 함께 담긴다.
- 클립보드가 막히면 완료로 넘어가지 않고 직접 복사할 문구를 남긴다.
- 출력하지 않은 내부 기록은 완료로 표시되지 않는다.
- 필수 과업이 남아 있으면 게시 단추가 잠긴다.
- 정정 시작만으로는 원본 게시가 내려가지 않는다.

## Final verification

```text
npm run typecheck   통과
npm test            engine 160개, web 235개, 합계 395개 통과
npm run build       통과
npm run check       통과
npm run smoke       모두 통과 (1440px, 390px, 320px)
git diff --check    통과
```

## Concern

정정 사건의 대체 게시 전 과정은 아직 브라우저에서 끝까지 걷지 않았다. 도메인 규칙은
`publication.test.ts` 가 덮고, 화면에서는 정정 사건 생성까지만 확인했다. 나머지 절반은
작업 13 의 다섯째 여정에서 잠근다.
