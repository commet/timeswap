import type { ScheduleConfig } from './types.js';

export const slotOf = (day: number, period: number, cfg: ScheduleConfig): number =>
  day * cfg.periods + period;

export const dayOf = (slot: number, cfg: ScheduleConfig): number =>
  Math.floor(slot / cfg.periods);

export const periodOf = (slot: number, cfg: ScheduleConfig): number => slot % cfg.periods;

export const slotName = (slot: number, cfg: ScheduleConfig): string =>
  `${cfg.dayNames[dayOf(slot, cfg)]}요일 ${periodOf(slot, cfg) + 1}교시`;

export const bit = (slot: number): bigint => 1n << BigInt(slot);

export const hasBit = (mask: bigint, slot: number): boolean => (mask & bit(slot)) !== 0n;
