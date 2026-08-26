import { describe, expect, it } from 'vitest';

import {
  formatLocation,
  parseLocation,
  pushLocation,
  subscribeToPopState,
} from '../lib/navigation';
import type { AppLocation } from '../lib/navigation';

class HistoryDouble {
  readonly entries: string[] = ['/?view=teacher&school=joyul-demo&teacher=%EA%B9%80%EC%88%98%ED%95%99'];
  private index = 0;
  private readonly listeners = new Set<() => void>();

  private get url(): URL {
    const value = new URL(this.entries[this.index]!, 'https://joyul.example');
    return value;
  }

  get pathname(): string { return this.url.pathname; }
  get search(): string { return this.url.search; }

  pushState(_data: unknown, _title: string, url?: string | URL | null): void {
    this.entries.splice(this.index + 1);
    this.entries.push(String(url));
    this.index += 1;
  }

  replaceState(_data: unknown, _title: string, url?: string | URL | null): void {
    this.entries[this.index] = String(url);
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'popstate') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'popstate') this.listeners.delete(listener);
  }

  back(): void {
    this.index -= 1;
    this.listeners.forEach((listener) => listener());
  }
}

describe('query navigation', () => {
  it('round-trips public Korean view identity through a static-export-safe query', () => {
    const location: AppLocation = { view: 'class', school: '조율고등학교', grade: '2', className: '4' };

    expect(formatLocation(location)).toBe('/?view=class&school=%EC%A1%B0%EC%9C%A8%EA%B3%A0%EB%93%B1%ED%95%99%EA%B5%90&grade=2&class=4');
    expect(parseLocation(formatLocation(location))).toEqual(location);
    expect(parseLocation('/?view=ops&school=joyul-demo&case=case-1')).toEqual({ view: 'ops', school: 'joyul-demo', caseId: 'case-1' });
  });

  it('keeps each mobile operations step addressable without accepting a step without its case', () => {
    const detail: AppLocation = {
      view: 'ops', school: 'joyul-demo', caseId: 'case-1', step: 'case',
    };
    const administration: AppLocation = {
      view: 'ops', school: 'joyul-demo', caseId: 'case-1', step: 'admin',
    };

    expect(parseLocation(formatLocation(detail))).toEqual(detail);
    expect(parseLocation(formatLocation(administration))).toEqual(administration);
    expect(parseLocation('/?view=ops&school=joyul-demo&step=admin')).toEqual({ view: 'landing' });
  });

  it('round-trips a landing school name into the initial setup search', () => {
    const location: AppLocation = { view: 'setup', schoolQuery: '수지고등학교' };

    expect(formatLocation(location)).toBe('/?view=setup&q=%EC%88%98%EC%A7%80%EA%B3%A0%EB%93%B1%ED%95%99%EA%B5%90');
    expect(parseLocation(formatLocation(location))).toEqual(location);
  });

  it('returns landing for incomplete, unknown, or sensitive locations', () => {
    expect(parseLocation('/?view=teacher&school=joyul-demo')).toEqual({ view: 'landing' });
    expect(parseLocation('/?view=class&school=joyul-demo&grade=2')).toEqual({ view: 'landing' });
    expect(parseLocation('/?view=ops&school=joyul-demo&neisKey=secret')).toEqual({ view: 'landing' });
    expect(parseLocation('/internal?view=teacher&school=joyul-demo&teacher=%EA%B9%80%EC%88%98%ED%95%99'))
      .toEqual({ view: 'landing' });
    expect(parseLocation('http://[bad')).toEqual({ view: 'landing' });
  });

  it('notifies views in browser back-button order', () => {
    const history = new HistoryDouble();
    const seen: AppLocation[] = [];
    const stop = subscribeToPopState(history, history, (location) => seen.push(location));

    pushLocation(history, { view: 'ops', school: 'joyul-demo', caseId: 'case-1' });
    pushLocation(history, { view: 'ops', school: 'joyul-demo' });
    history.back();
    history.back();
    stop();

    expect(seen).toEqual([
      { view: 'ops', school: 'joyul-demo', caseId: 'case-1' },
      { view: 'teacher', school: 'joyul-demo', teacher: '김수학' },
    ]);
  });
});

/**
 * 특수학교의 학교 과정.
 *
 * 특수학교는 초등부와 중학부, 고등부를 함께 운영하고 학년이 과정마다 1부터 다시
 * 센다. 한 학교에 1학년 1반이 셋 있고 실측한 32곳 가운데 31곳이 그렇다.
 * 주소에 과정이 없으면 셋 가운데 하나만 열리고 나머지 둘은 갈 방법이 없다.
 */
describe('학급 주소와 학교 과정', () => {
  it('과정을 주소에 담고 다시 읽는다', () => {
    const href = formatLocation({
      view: 'class', school: '7010084', grade: '1', className: '1', course: '중학교',
    });
    expect(href).toContain('course=%EC%A4%91%ED%95%99%EA%B5%90');
    expect(parseLocation(href)).toEqual({
      view: 'class', school: '7010084', grade: '1', className: '1', course: '중학교',
    });
  });

  it('과정이 다르면 다른 주소다', () => {
    const a = formatLocation({ view: 'class', school: 'S', grade: '1', className: '1', course: '초등학교' });
    const b = formatLocation({ view: 'class', school: 'S', grade: '1', className: '1', course: '중학교' });
    expect(a).not.toBe(b);
  });

  it('과정이 없는 옛 주소도 그대로 열린다', () => {
    expect(parseLocation('/?view=class&school=S&grade=1&class=1')).toEqual({
      view: 'class', school: 'S', grade: '1', className: '1',
    });
  });

  it('초중고는 과정을 안 붙인다', () => {
    expect(formatLocation({ view: 'class', school: 'S', grade: '2', className: '7' })).not.toContain('course=');
  });
});
