export type AppLocation =
  | { view: 'landing' }
  | { view: 'setup'; schoolQuery?: string }
  | { view: 'teacher'; school: string; teacher: string }
  | { view: 'ops'; school: string; caseId?: string; step?: 'case' | 'admin' }
  /**
   * 학급 시간표 공개 화면.
   *
   * `course` 는 특수학교의 학교 과정이다. 특수학교는 초등부와 중학부, 고등부를 함께
   * 운영하고 학년이 과정마다 1부터 다시 세서 한 학교에 1학년 1반이 셋 있다.
   * 실측한 32곳 가운데 31곳이 그렇다. 이 값이 없으면 셋 가운데 하나만 열리고
   * 나머지 둘은 주소로 갈 방법이 없다.
   *
   * 초중고에는 이 항목이 아예 없으므로 붙이지 않는다. 옛 주소도 그대로 열린다.
   */
  | { view: 'class'; school: string; grade: string; className: string; course?: string };

type PushHistoryLike = Pick<History, 'pushState'>;
type ReplaceHistoryLike = Pick<History, 'replaceState'>;
type LocationLike = Pick<Location, 'pathname' | 'search'>;
type PopStateTarget = {
  addEventListener(type: 'popstate', listener: () => void): void;
  removeEventListener(type: 'popstate', listener: () => void): void;
};

function required(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 && values[0]!.trim() ? values[0]! : null;
}

function hasOnly(params: URLSearchParams, keys: readonly string[]): boolean {
  return [...params.keys()].every((key) => keys.includes(key));
}

export function formatLocation(location: AppLocation): string {
  if (location.view === 'landing') return '/';
  const params = new URLSearchParams({ view: location.view });
  if (location.view === 'setup') {
    if (location.schoolQuery?.trim()) params.set('q', location.schoolQuery.trim());
    return `/?${params}`;
  }
  params.set('school', location.school);
  if (location.view === 'teacher') params.set('teacher', location.teacher);
  if (location.view === 'ops') {
    if (location.caseId) params.set('case', location.caseId);
    if (location.step) params.set('step', location.step);
  }
  if (location.view === 'class') {
    params.set('grade', location.grade);
    params.set('class', location.className);
    if (location.course) params.set('course', location.course);
  }
  return `/?${params}`;
}

export function parseLocation(input: string | LocationLike): AppLocation {
  let parsed: LocationLike;
  try {
    parsed = typeof input === 'string'
      ? new URL(input, 'https://static-export.invalid')
      : input;
  } catch {
    return { view: 'landing' };
  }
  if (parsed.pathname !== '/') return { view: 'landing' };
  const search = parsed.search;
  const params = new URLSearchParams(search);
  const view = required(params, 'view');
  if (view === 'setup' && hasOnly(params, ['view', 'q'])) {
    const schoolQuery = params.has('q') ? required(params, 'q') : undefined;
    return schoolQuery !== null
      ? { view, ...(schoolQuery ? { schoolQuery: schoolQuery.trim() } : {}) }
      : { view: 'landing' };
  }
  if (view === 'teacher' && hasOnly(params, ['view', 'school', 'teacher'])) {
    const school = required(params, 'school');
    const teacher = required(params, 'teacher');
    return school && teacher ? { view, school, teacher } : { view: 'landing' };
  }
  if (view === 'ops' && hasOnly(params, ['view', 'school', 'case', 'step'])) {
    const school = required(params, 'school');
    const caseId = params.has('case') ? required(params, 'case') : undefined;
    const step = params.has('step') ? required(params, 'step') : undefined;
    if (!school || caseId === null || step === null) return { view: 'landing' };
    if (step !== undefined && step !== 'case' && step !== 'admin') return { view: 'landing' };
    if (step && !caseId) return { view: 'landing' };
    return { view, school, ...(caseId ? { caseId } : {}), ...(step ? { step } : {}) };
  }
  if (view === 'class' && hasOnly(params, ['view', 'school', 'grade', 'class', 'course'])) {
    const school = required(params, 'school');
    const grade = required(params, 'grade');
    const className = required(params, 'class');
    const course = params.get('course') ?? '';
    return school && grade && className
      ? { view, school, grade, className, ...(course ? { course } : {}) }
      : { view: 'landing' };
  }
  return { view: 'landing' };
}

function browserHistory(): History {
  return window.history;
}

export function pushLocation(location: AppLocation): void;
export function pushLocation(history: PushHistoryLike, location: AppLocation): void;
export function pushLocation(first: AppLocation | PushHistoryLike, second?: AppLocation): void {
  const [history, location] = second ? [first as PushHistoryLike, second] : [browserHistory(), first as AppLocation];
  history.pushState(null, '', formatLocation(location));
}

export function replaceLocation(location: AppLocation): void;
export function replaceLocation(history: ReplaceHistoryLike, location: AppLocation): void;
export function replaceLocation(first: AppLocation | ReplaceHistoryLike, second?: AppLocation): void {
  const [history, location] = second ? [first as ReplaceHistoryLike, second] : [browserHistory(), first as AppLocation];
  history.replaceState(null, '', formatLocation(location));
}

export function subscribeToPopState(onLocation: (location: AppLocation) => void): () => void;
export function subscribeToPopState(
  location: LocationLike,
  target: PopStateTarget,
  onLocation: (location: AppLocation) => void,
): () => void;
export function subscribeToPopState(
  first: LocationLike | ((location: AppLocation) => void),
  second?: PopStateTarget,
  third?: (location: AppLocation) => void,
): () => void {
  const location = typeof first === 'function' ? window.location : first;
  const target = typeof first === 'function' ? window : second!;
  const onLocation = typeof first === 'function' ? first : third!;
  const listener = () => onLocation(parseLocation(location));
  target.addEventListener('popstate', listener);
  return () => target.removeEventListener('popstate', listener);
}
