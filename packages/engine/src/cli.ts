/**
 * 엔진 데모 CLI.
 * 사용: npm run demo -- [--seed 42] [--classes 12] [--teacher 수학1] [--slot 9]
 *       npm run demo -- --fixture test/fixtures/comcigan-demo.json [--teacher 이수*]
 * 합성 학교(또는 컴시간 뷰어 JSON)에서 결강 1건에 대한 교환 추천을 출력한다.
 */
import { readFileSync } from 'node:fs';
import { genSchool } from './synthetic';
import { fromComcigan, type ComciganData } from './adapters/comcigan';
import { recommend } from './search';
import { validate } from './timetable';
import { slotName } from './slots';
import type { TimetableInput } from './types';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seed = Number(arg('seed') ?? 42);
const classes = Number(arg('classes') ?? 12);
const fixture = arg('fixture');

const t0 = performance.now();
let school: TimetableInput;
if (fixture) {
  const data = JSON.parse(readFileSync(fixture, 'utf8')) as ComciganData;
  const adapted = fromComcigan(data);
  school = adapted.input;
  console.log(
    `픽스처 학교: ${adapted.schoolName}, 변경 반영 ${adapted.changedLessons}건, 동시수업 묶음 ${adapted.groupedLessons}건`,
  );
} else {
  school = genSchool({ classes, seed });
}
const t1 = performance.now();

const errors = validate(school);
if (errors.length > 0) {
  console.error('합성 시간표가 불변식을 어겼습니다:', errors.slice(0, 5));
  process.exit(1);
}

const teachers = new Set(school.assignments.map((a) => a.teacher));
const klassCount = new Set(school.assignments.map((a) => a.klass)).size;
const fallback = school.assignments.find((a) => !a.group);
const teacher = arg('teacher') ?? (fixture ? fallback?.teacher : '수학1') ?? '수학1';
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
