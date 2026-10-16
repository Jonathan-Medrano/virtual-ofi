import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseLines, deriveStatus, PENDING_TOOL_MS } from './state';

const fx = (name: string) =>
  parseLines(readFileSync(new URL(`./fixtures/${name}.jsonl`, import.meta.url), 'utf8'));
const at = (h: number, m: number, s: number) => Date.UTC(2026, 9, 16, h, m, s);

describe('deriveStatus', () => {
  it('turn_end_then_2min_is_idle', () => {
    // fin de turno a las 12:00:20
    expect(deriveStatus(fx('turn_end'), at(12, 2, 20))).toBe('idle');
  });

  it('turn_end_recent_is_waiting', () => {
    expect(deriveStatus(fx('turn_end'), at(12, 0, 40))).toBe('waiting');
    expect(deriveStatus(fx('turn_end'), at(12, 2, 19))).toBe('waiting');
  });

  it('tool_call_open_is_working', () => {
    // tool_use a las 12:00:10, sin resultado, hace 5 s
    expect(deriveStatus(fx('working'), at(12, 0, 15))).toBe('working');
  });

  it('permission_pending_is_waiting', () => {
    expect(PENDING_TOOL_MS).toBe(15_000);
    // tool_use a las 12:00:05
    expect(deriveStatus(fx('pending_tool'), at(12, 0, 19))).toBe('working');
    expect(deriveStatus(fx('pending_tool'), at(12, 0, 20))).toBe('waiting');
    expect(deriveStatus(fx('pending_tool'), at(12, 5, 0))).toBe('waiting');
  });

  it('user_or_tool_result_is_working_then_idle', () => {
    const recs = parseLines(
      '{"type":"user","timestamp":"2026-10-16T12:00:00.000Z","message":{"content":[{"type":"tool_result"}]}}\n',
    );
    expect(deriveStatus(recs, at(12, 1, 0))).toBe('working');
    expect(deriveStatus(recs, at(12, 2, 0))).toBe('idle');
  });

  it('15min_is_closed', () => {
    expect(deriveStatus(fx('turn_end'), at(12, 15, 20))).toBe('closed');
    expect(deriveStatus(fx('pending_tool'), at(12, 15, 5))).toBe('closed');
    expect(deriveStatus(fx('turn_end'), at(12, 15, 19))).toBe('idle');
  });

  it('respects custom opts', () => {
    const o = { idleMs: 10_000, closedMs: 60_000 };
    expect(deriveStatus(fx('turn_end'), at(12, 0, 31), o)).toBe('idle');
    expect(deriveStatus(fx('turn_end'), at(12, 1, 20), o)).toBe('closed');
  });

  it('empty_is_closed', () => {
    expect(deriveStatus(fx('empty'), at(12, 0, 0))).toBe('closed');
    expect(deriveStatus([], at(12, 0, 0))).toBe('closed');
  });

  it('unknown_types_ignored', () => {
    // el "algo-nuevo" de 12:00:03 y "otro" no cambian el estado: manda el end_turn de 12:00:10
    expect(deriveStatus(fx('unknown_types'), at(12, 0, 30))).toBe('waiting');
    expect(deriveStatus(fx('unknown_types'), at(12, 2, 10))).toBe('idle');
  });
});

describe('parseLines', () => {
  it('truncated_last_line_ignored', () => {
    const raw =
      '{"type":"user","timestamp":"2026-10-16T12:00:00.000Z"}\n' +
      '{"type":"assistant","timestamp":"2026-10-16T12:00:10.000Z","message":{"stop_reason":"end_turn"}}\n' +
      '{"type":"assistant","timestamp":"2026-10-16T12:0';
    const recs = parseLines(raw);
    expect(recs).toHaveLength(2);
    expect(deriveStatus(recs, at(12, 0, 30))).toBe('waiting');
  });

  it('truncated fixture: se descarta la última línea a medias y se conserva el fin de turno', () => {
    const recs = fx('truncated');
    expect(recs.map((r) => r.type)).toEqual(['bridge-session', 'user', 'assistant']);
    expect(deriveStatus(recs, at(12, 0, 30))).toBe('waiting');
  });

  it('ignores blanks, non-objects and invalid JSON', () => {
    expect(parseLines('\n  \nnope\n123\n[1]\nnull\n{"type":"user"}\r\n')).toEqual([{ type: 'user' }]);
  });

  it('ignores objects without string type', () => {
    expect(parseLines('{"foo":1}\n{"type":5}')).toEqual([]);
  });
});
