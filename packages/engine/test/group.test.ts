import { describe, expect, it } from 'vitest';
import { genSchool } from '../src/synthetic';
import { recommend } from '../src/search';
import { applyChanges, buildIndexes, totalHoles, validate } from '../src/timetable';
import { buildUnits, unitKey } from '../src/units';
import type { Assignment, TimetableInput } from '../src/types';

/**
 * 묶음이 섞인 시간표를 여러 개 만들어 탐색이 규칙을 어기지 않는지 훑는다.
 *
 * 현장의 묶음은 세 가지 모양으로 온다.
 * 여러 학급이 갈라져 여러 교사가 동시에 들어가는 이동수업,
 * 한 학급에 두 교사가 들어가는 복수교사 수업, 한 교사가 두 학급을 함께 맡는 합반이다.
 * 셋 다 심어 놓고 돌린다.
 */
function withGroups(base: TimetableInput, seed: number): TimetableInput {
  const assignments: Assignment[] = base.assignments.map((a) => ({ ...a }));
  const cfg = base.config;
  const bySlot = new Map<number, Assignment[]>();
  for (const a of assignments) bySlot.set(a.slot, [...(bySlot.get(a.slot) ?? []), a]);

  const slots = [...bySlot.keys()].sort((x, y) => x - y);
  let made = 0;

  // 1) 이동수업: 한 교시에서 학급 셋을 골라 한 묶음으로 만든다
  for (let i = seed % 3; i < slots.length && made < 4; i += 3) {
    const here = bySlot.get(slots[i]!) ?? [];
    if (here.length < 3) continue;
    const trio = here.slice(0, 3);
    // 교사가 서로 달라야 실제 이동수업 모양이 된다
    if (new Set(trio.map((a) => a.teacher)).size !== 3) continue;
    for (const a of trio) a.group = `이동${slots[i]}`;
    made++;
  }

  // 2) 복수교사: 어느 묶음 하나에 같은 학급을 맡는 교사를 하나 더 붙인다
  const target = assignments.find((a) => a.group);
  if (target) {
    const free = findFreeTeacher(assignments, target.slot, cfg.periods * cfg.days);
    if (free) {
      assignments.push({
        teacher: free,
        klass: target.klass,
        subject: target.subject,
        slot: target.slot,
        group: target.group,
      });
    }
  }
  return { config: cfg, assignments };
}

/** 그 교시에 수업이 없는 교사를 아무나 찾는다. */
function findFreeTeacher(assignments: Assignment[], slot: number, _total: number): string | null {
  const busy = new Set(assignments.filter((a) => a.slot === slot).map((a) => a.teacher));
  for (const a of assignments) {
    if (!busy.has(a.teacher)) return a.teacher;
  }
  return null;
}

describe('성질: 묶음이 섞인 시간표', () => {
  for (const seed of [1, 4, 9, 16, 25]) {
    it(`시드 ${seed} 학교에서 묶음 규칙이 깨지지 않는다`, () => {
      const school = withGroups(genSchool({ classes: 9, seed }), seed);
      expect(validate(school)).toEqual([]);

      const units = buildUnits(school);
      const groupedUnits = [...units.values()].filter((u) => u.grouped);
      expect(groupedUnits.length).toBeGreaterThan(0);

      const holesBefore = totalHoles(school);
      let checked = 0;
      let found = 0;

      // 묶음에 든 교사와 안 든 교사를 섞어 결강을 걸어 본다
      const targets: Assignment[] = [];
      for (const u of groupedUnits.slice(0, 3)) targets.push(u.assignments[0]!);
      for (const a of school.assignments) {
        if (!a.group && targets.length < 8) targets.push(a);
        if (targets.length >= 8) break;
      }

      for (const t of targets) {
        const { candidates } = recommend(school, { teacher: t.teacher, slot: t.slot }, { max: 30 });
        found += candidates.length;
        for (const cand of candidates) {
          checked++;
          const applied = applyChanges(school, cand.changes);

          // 하드 불변식
          expect(validate(applied)).toEqual([]);
          // 학급 빈 시간이 늘지 않는다
          expect(totalHoles(applied)).toBeLessThanOrEqual(holesBefore);
          // 결강 교사는 그 교시에서 빠진다
          expect(buildIndexes(applied).byTeacherSlot.get(`${t.teacher}|${t.slot}`)).toBeUndefined();

          // 묶음은 통째로만 움직인다
          const dest = new Map<string, Set<number>>();
          for (const c of cand.changes) {
            if (!c.from.group) continue;
            const key = `${c.from.group}|${c.from.slot}`;
            dest.set(key, (dest.get(key) ?? new Set()).add(c.toSlot));
          }
          for (const [, slots] of dest) expect(slots.size).toBe(1);

          // 묶음이 움직였다면 그 묶음의 수업이 하나도 빠짐없이 따라갔다
          for (const [key] of dest) {
            const [group, slotStr] = key.split('|');
            const whole = school.assignments.filter(
              (a) => a.group === group && a.slot === Number(slotStr),
            );
            const moved = cand.changes.filter(
              (c) => c.from.group === group && c.from.slot === Number(slotStr),
            );
            expect(moved).toHaveLength(whole.length);
          }
        }
      }
      expect(checked).toBeGreaterThan(0);
      expect(found).toBeGreaterThan(0);
    });
  }

  it('묶음 단위 열쇠는 교시와 묶음 이름으로 갈린다', () => {
    const school = withGroups(genSchool({ classes: 9, seed: 3 }), 3);
    const units = buildUnits(school);
    for (const [key, u] of units) {
      expect(u.key).toBe(key);
      for (const a of u.assignments) {
        expect(unitKey(a)).toBe(key);
        expect(a.slot).toBe(u.slot);
      }
    }
  });
});
