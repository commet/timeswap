/**
 * 엔진 데모 CLI.
 * 사용: npm run demo -- [--seed 42] [--classes 12] [--teacher 수학1] [--slot 9]
 *       npm run demo -- --neis test/fixtures/neis-himetable.json
 * 합성 학교에서 결강 1건에 대한 교환 추천을 출력한다.
 * --neis 를 주면 나이스 교육정보 개방 포털 응답을 읽어 변경 이력을 요약한다.
 */
import { readFileSync } from 'node:fs';
import { genSchool } from './synthetic';
import { fromNeis, type NeisRow } from './adapters/neis';
import { recommend } from './search';
import { validate } from './timetable';
import { slotName } from './slots';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const neisFile = arg('neis');
if (neisFile) {
  const parsed = JSON.parse(readFileSync(neisFile, 'utf8')) as { rows?: NeisRow[] } | NeisRow[];
  const rows = Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
  const report = fromNeis(rows);
  console.log(`나이스 개방 자료: ${report.schoolName}`);
  console.log(`  관측 칸 ${report.cells.length}개, 휴업일 ${report.holidays.length}일`);
  console.log(`  보강 ${report.covers.length}건, 기준과 다른 칸 ${report.changes.length}개`);
  console.log(`  맞교환으로 보이는 사례 ${report.swaps.length}건`);
  for (const s of report.swaps) {
    console.log(
      `    ${s.date} ${s.klass}: ${s.periodA + 1}교시(${s.subjectA}) <-> ${s.periodB + 1}교시(${s.subjectB})`,
    );
  }
  for (const c of report.covers) {
    console.log(`    보강 ${c.date} ${c.klass} ${c.period + 1}교시 ${c.subject}`);
  }
  process.exit(0);
}

const seed = Number(arg('seed') ?? 42);
const classes = Number(arg('classes') ?? 12);

const t0 = performance.now();
const school = genSchool({ classes, seed });
const t1 = performance.now();

const errors = validate(school);
if (errors.length > 0) {
  console.error('합성 시간표가 불변식을 어겼습니다:', errors.slice(0, 5));
  process.exit(1);
}

const teachers = new Set(school.assignments.map((a) => a.teacher));
const klassCount = new Set(school.assignments.map((a) => a.klass)).size;
const teacher = arg('teacher') ?? '수학1';
const firstLesson = school.assignments.find((a) => a.teacher === teacher && !a.group);
if (!firstLesson) {
  console.error(`${teacher} 선생님의 수업이 없습니다`);
  process.exit(1);
}
const slot = Number(arg('slot') ?? firstLesson.slot);

const t2 = performance.now();
const result = recommend(school, { teacher, slot }, { max: 5 });
const t3 = performance.now();

const cfg = school.config;
console.log('시간표 규모');
console.log(
  `  학급 ${klassCount}개, 교사 ${teachers.size}명, 수업 ${school.assignments.length}개, 준비 ${(t1 - t0).toFixed(0)}ms`,
);
console.log('');
console.log(
  `결강: ${result.target.teacher} 선생님, ${slotName(slot, cfg)}, ${result.target.klass} ${result.target.subject}`,
);
console.log(`탐색 시간: ${(t3 - t2).toFixed(1)}ms`);
console.log('');
for (const note of result.notes) console.log(`안내: ${note}`);
result.candidates.forEach((c, i) => {
  console.log(`${i + 1}. [${c.score}점] ${c.title}`);
  for (const tr of c.trace) {
    const pts = tr.points !== undefined ? ` (${tr.points > 0 ? '+' : ''}${tr.points})` : '';
    console.log(`     ${tr.kind} | ${tr.text}${pts}`);
  }
});
