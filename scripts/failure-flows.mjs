/**
 * 잘 될 때가 아니라 안 될 때 무엇이 보이는지 잰다.
 *
 * 학교에서 실제로 겪는 실패는 세 가지 모양이다. 호출 한도에 걸리거나, 네트워크가
 * 끊기거나, 받은 줄 수가 공식 총계와 다르다. 셋 다 화면은 원인을 이름으로 말하고
 * 다음에 할 일 하나를 주어야 하며, 어떤 경우에도 완전한 시간표 버전을 만들면 안 된다.
 * 불완전한 자료로 만든 버전은 이후 모든 추천을 조용히 오염시킨다.
 */

const SCHOOL_RESPONSE = {
  schoolInfo: [
    { head: [{ list_total_count: 1 }, { RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다.' } }] },
    { row: [{
      ATPT_OFCDC_SC_CODE: 'J10', ATPT_OFCDC_SC_NM: '경기도교육청',
      SD_SCHUL_CODE: '7531057', SCHUL_NM: '수지고등학교', SCHUL_KND_SC_NM: '고등학교',
    }] },
  ],
};

const timetableRow = (period, subject) => ({
  ATPT_OFCDC_SC_CODE: 'J10',
  SD_SCHUL_CODE: '7531057',
  ALL_TI_YMD: '20260818',
  GRADE: '2',
  CLASS_NM: '1',
  PERIO: String(period),
  ITRT_CNTNT: subject,
  AY: '2026',
  SEM: '2',
  DGHT_CRSE_SC_NM: '주간',
  ORD_SC_NM: '공업계',
  DDDEP_NM: '기계과',
});

/** 설정 화면에서 학교와 인증키를 채우고 공식 자료 불러오기 앞까지 간다. */
async function reachOfficialLoad(page, BASE) {
  await page.goto(`${BASE}/?view=setup`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(100);
  await page.getByRole('textbox', { name: '학교 이름' }).fill('수지고등학교');
  await page.getByRole('button', { name: '학교 찾기' }).click();
  await page.getByRole('button', { name: /수지고등학교/ }).click();
  await page.waitForTimeout(80);
  await page.getByPlaceholder('인증키를 붙여 넣으십시오').fill('demo-session-key-not-real');
  await page.getByRole('button', { name: '공식 자료 불러오기로 계속' }).click();
  await page.waitForTimeout(80);
  await page.locator('.load-official').click();
  await page.waitForTimeout(250);
}

async function noCompleteRevisionStored(page) {
  return page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith('joyul:v2:workspace:')) continue;
      const state = JSON.parse(localStorage.getItem(key));
      if (state.revisions?.some((revision) => revision.complete)) return false;
    }
    return true;
  });
}

const FLOWS = [
  {
    id: '호출 한도',
    // 나이스는 한도를 넘기면 코드 337 을 준다. 빈 결과와 구분되어야 한다.
    async route(page) {
      await page.route('**/hub/hisTimetable**', async (route) => {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ RESULT: { CODE: 'INFO-337', MESSAGE: '일일 호출 제한을 초과하였습니다.' } }),
        });
      });
    },
    expect: ['제한', '초과'],
  },
  {
    id: '네트워크 끊김',
    async route(page) {
      await page.route('**/hub/hisTimetable**', (route) => route.abort('failed'));
    },
    expect: ['연결', '네트워크'],
  },
  {
    id: '총계 불일치',
    // 공식 총계는 6인데 6줄째가 오지 않았다. 다섯 줄을 전부로 보면 안 된다.
    async route(page) {
      await page.route('**/hub/hisTimetable**', async (route) => {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ hisTimetable: [
            { head: [{ list_total_count: 6 }, { RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다.' } }] },
            { row: [1, 2, 3, 4, 5].map((period) => timetableRow(period, `과목${period}`)) },
          ] }),
        });
      });
    },
    expect: ['5', '6'],
  },
];

export async function runFailureFlows(browser, BASE, failures, shot) {
  for (const flow of FLOWS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await ctx.newPage();
    page.on('pageerror', (error) => failures.push(`${flow.id} 페이지 오류: ${error.message}`));
    await page.route('**/hub/schoolInfo**', async (route) => {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(SCHOOL_RESPONSE) });
    });
    await flow.route(page);

    try {
      await reachOfficialLoad(page, BASE);
    } catch (error) {
      failures.push(`${flow.id}: 공식 자료 불러오기까지 가지 못함 (${error.message.split('\n')[0]})`);
      await ctx.close();
      continue;
    }

    const seen = await page.evaluate(() => ({
      alerts: [...document.querySelectorAll('[role="alert"], .neis-error, .setup-alert, .health-status')]
        .map((node) => node.textContent?.trim() ?? '')
        .filter(Boolean),
      // 다음에 할 일이 하나는 열려 있어야 한다. 잠긴 화면은 막다른 길이다.
      actions: [...document.querySelectorAll('button:not([disabled])')]
        .map((node) => node.textContent?.trim() ?? '')
        .filter(Boolean),
      advanced: Boolean(document.querySelector('[data-setup-stage="교사 연결"][aria-current="true"]')),
    }));
    const message = seen.alerts.join(' ');
    if (!message) {
      failures.push(`${flow.id}: 실패를 알리는 문구가 없음`);
    } else {
      for (const need of flow.expect) {
        if (!message.includes(need)) {
          failures.push(`${flow.id}: 원인을 "${need}" 로 말하지 않음 (${message.slice(0, 90)})`);
        }
      }
    }
    if (seen.actions.length === 0) failures.push(`${flow.id}: 다음에 할 행동이 하나도 없음`);
    if (seen.advanced) failures.push(`${flow.id}: 실패했는데 다음 단계로 넘어감`);
    if (!(await noCompleteRevisionStored(page))) {
      failures.push(`${flow.id}: 실패했는데 완전한 시간표 버전이 저장됨`);
    }
    await shot(page, `failure-${flow.id.replace(/\s/g, '-')}`);
    await ctx.close();
  }
}
