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

  it('returns landing for incomplete, unknown, or sensitive locations', () => {
    expect(parseLocation('/?view=teacher&school=joyul-demo')).toEqual({ view: 'landing' });
    expect(parseLocation('/?view=class&school=joyul-demo&grade=2')).toEqual({ view: 'landing' });
    expect(parseLocation('/?view=ops&school=joyul-demo&neisKey=secret')).toEqual({ view: 'landing' });
    expect(parseLocation('/internal?view=teacher&school=joyul-demo&teacher=%EA%B9%80%EC%88%98%ED%95%99'))
      .toEqual({ view: 'landing' });
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
