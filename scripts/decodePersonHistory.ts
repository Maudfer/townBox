// Person-history decode diagnostic (task 080 / proposal K4). Decodes one or more `person-<id>.tbz` files
// from the committed history asset and prints the views the aliveness audit used: entry counts, an
// action/event frequency table, per-event totals, sleep-duration stats, and (with --slice) a readable
// multi-day timeline. Run with `npm run decode-person -- p108 [p146 ...] [--top 40] [--slice 0.5] [--days 3]
// [--dir src/history]`. Read-only; safe to run against any format-v2 asset directory.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { decompress } from 'util/compress';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from 'util/time';

interface RawEntry {
    tick: number;
    kind: 'action' | 'event';
    defId: string;
    instanceId?: string;
    lifecycle?: string;
    params?: Record<string, unknown>;
    parentInstanceId?: string | null;
    triggerSource?: string;
    causationId?: number | null;
    seq: number;
}

interface PersonChunk {
    log?: RawEntry[];
    skills?: unknown[];
}

function parseArgs(argv: string[]): { ids: string[]; dir: string; top: number; slice: number | null; days: number } {
    const ids: string[] = [];
    let dir = 'src/history';
    let top = 40;
    let slice: number | null = null;
    let days = 3;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === '--dir') {
            dir = argv[++i]!;
        } else if (arg === '--top') {
            top = Number(argv[++i]);
        } else if (arg === '--slice') {
            slice = Number(argv[++i]);
        } else if (arg === '--days') {
            days = Number(argv[++i]);
        } else if (!arg.startsWith('--')) {
            ids.push(arg);
        }
    }
    return { ids, dir, top, slice, days };
}

function decodePerson(file: string): { log: RawEntry[]; skillSnapshots: number } {
    const raw = readFileSync(file, 'utf8');
    const log: RawEntry[] = [];
    let skillSnapshots = 0;
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        const chunk = JSON.parse(decompress(trimmed)) as PersonChunk;
        for (const entry of chunk.log ?? []) {
            log.push(entry);
        }
        skillSnapshots += chunk.skills?.length ?? 0;
    }
    return { log, skillSnapshots };
}

function frequencyTable(log: RawEntry[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const entry of log) {
        const suffix = entry.kind === 'action' && entry.lifecycle && entry.lifecycle !== 'performed' ? `:${entry.lifecycle}` : '';
        const key = `${entry.kind === 'action' ? 'A' : 'E'}:${entry.defId}${suffix}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
}

function sleepStats(log: RawEntry[]): string {
    const started = new Map<string, number>();
    const durations = new Map<number, number>();
    let total = 0;
    for (const entry of log) {
        if (entry.defId !== 'sleep' || !entry.instanceId) {
            continue;
        }
        if (entry.lifecycle === 'started') {
            started.set(entry.instanceId, entry.tick);
        } else if (entry.lifecycle === 'completed' && started.has(entry.instanceId)) {
            const duration = entry.tick - started.get(entry.instanceId)!;
            durations.set(duration, (durations.get(duration) ?? 0) + 1);
            started.delete(entry.instanceId);
            total++;
        }
    }
    if (total === 0) {
        return 'no completed sleeps';
    }
    const parts = [...durations.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([duration, count]) => `${duration}h x${count}`);
    return `${total} sleeps; top durations: ${parts.join(', ')}`;
}

function printSlice(log: RawEntry[], fraction: number, days: number): void {
    if (log.length === 0) {
        return;
    }
    const anchor = log[Math.min(log.length - 1, Math.floor(log.length * fraction))]!.tick;
    const end = anchor + days * TICKS_PER_DAY;
    console.log(`\n-- timeline slice (${days} days from tick ${anchor}) --`);
    for (const entry of log) {
        if (entry.tick < anchor || entry.tick >= end) {
            continue;
        }
        const day = Math.floor(entry.tick / TICKS_PER_DAY);
        const hour = ((entry.tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
        const kind = entry.kind === 'action' ? 'A' : 'E';
        const lifecycle = entry.lifecycle ?? '';
        const params = entry.params && Object.keys(entry.params).length > 0 ? ` ${JSON.stringify(entry.params)}` : '';
        console.log(`d${day} ${String(hour).padStart(2, '0')}:00 ${kind} ${entry.defId} ${lifecycle}${params}`);
    }
}

function main(): void {
    const { ids, dir, top, slice, days } = parseArgs(process.argv.slice(2));
    if (ids.length === 0) {
        console.error('usage: npm run decode-person -- <personId> [...] [--top N] [--slice 0..1] [--days N] [--dir src/history]');
        process.exit(1);
    }
    const base = resolve(dir);
    for (const id of ids) {
        const file = join(base, `person-${id}.tbz`);
        if (!existsSync(file)) {
            console.error(`${id}: no such file ${file}`);
            continue;
        }
        const { log, skillSnapshots } = decodePerson(file);
        const first = log[0]?.tick ?? 0;
        const last = log[log.length - 1]?.tick ?? 0;
        const actions = log.filter(entry => entry.kind === 'action').length;
        const events = log.length - actions;
        console.log(`\n=== ${id}: ${log.length} entries (${actions} actions, ${events} events), ` +
            `${skillSnapshots} skill snapshots, ticks ${first}..${last} (${((last - first) / TICKS_PER_YEAR).toFixed(1)}y) ===`);
        console.log(`sleep: ${sleepStats(log)}`);
        const sorted = [...frequencyTable(log).entries()].sort((a, b) => b[1] - a[1]);
        console.log(`\n-- top ${top} of ${sorted.length} distinct entries --`);
        for (const [key, count] of sorted.slice(0, top)) {
            console.log(`${String(count).padStart(7)} ${key}`);
        }
        if (slice !== null) {
            printSlice(log, slice, days);
        }
    }
}

main();
