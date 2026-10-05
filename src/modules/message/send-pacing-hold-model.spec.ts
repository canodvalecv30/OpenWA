import { DataSource } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { SendPacingService, type SettleAdmission } from './send-pacing.service';
import { Message } from './entities/message.entity';
import { Session } from '../session/entities/session.entity';
import { computeSendPacingConfig } from './send-pacing.config';

/**
 * Seeded interleavings of single sends, bulk items, hand-backs, unknown outcomes and rows landing late,
 * judged against the rows actually written. The hand-written cases in send-pacing-cold-query.spec.ts each
 * pin one ordering; this walks 120 seeded ones, so a change to how admissions are held has to keep every
 * property below on all of them:
 *
 *  - no cap is passed: the rows written plus the rows still due never exceed either allowance;
 *  - nothing is counted twice: once every admitted send has written its row, a probe passes exactly when
 *    the rows alone are under the cap;
 *  - a cold send that never writes a row stops counting against the cold cap once its own window ends,
 *    however many warm sends keep arriving.
 *
 * Every row here is written by an admitted send. A row the phone writes on its own is outside what the
 * hold can account for, and is left to the hand-written cases.
 */
describe('send pacing hold model', () => {
  const NOW = new Date('2026-08-03T12:00:00.000Z');
  const KNOWN = ['known0@c.us', 'known1@c.us', 'known2@c.us', 'known3@c.us'];
  let ds: DataSource;
  let seq = 0;

  interface Run {
    daily: number;
    cold: number;
    steps: number;
    /** Let a bulk item fail with an unknown outcome: settled as possibly sent, and no row ever lands. */
    unknown: boolean;
  }

  interface InFlight {
    kind: 'single' | 'bulk';
    chatId: string;
    settle?: SettleAdmission;
    settled: boolean;
    /** Epoch ms of its admission, or of its settle once settled. */
    at: number;
  }

  const build = ({ daily, cold }: Run): SendPacingService =>
    new SendPacingService(ds.getRepository(Message), ds.getRepository(Session), {
      get: (key: string) =>
        key === 'sendPacing'
          ? { ...computeSendPacingConfig({}), enabled: true, warmupSchedule: [daily], coldSchedule: cold ? [cold] : [] }
          : undefined,
    } as unknown as ConfigService);

  const insertRow = (chatId: string): Promise<unknown> =>
    ds.query(
      `INSERT INTO "messages" ("id","sessionId","chatId","from","to","type","direction","createdAt")
       VALUES (?,?,?,'a','b','text','outgoing',?)`,
      [`r${seq++}`, 's1', chatId, new Date().toISOString()],
    );

  const rowsToday = async (): Promise<number> => {
    const [row] = await ds.query<{ c: number }[]>(
      `SELECT COUNT(*) AS c FROM "messages" WHERE "sessionId" = 's1' AND "direction" = 'outgoing'`,
    );
    return Number(row.c);
  };

  /** Distinct strangers written to. Every row is from today and the known chats wrote first, so that is all a cold reachout is here. */
  const coldRowsToday = async (): Promise<Set<string>> => {
    const rows = await ds.query<{ chatId: string }[]>(
      `SELECT DISTINCT "chatId" FROM "messages" WHERE "sessionId" = 's1' AND "chatId" LIKE 'cold%'`,
    );
    return new Set(rows.map(row => row.chatId));
  };

  /** A linear congruential generator, so each seed replays the same interleaving. */
  const rng = (seed: number): (() => number) => {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
  };

  const refusal = (error: unknown): { retryAfterSeconds: number } => {
    if (!(error instanceof HttpException) || error.getStatus() !== 429) throw error;
    return error.getResponse() as { retryAfterSeconds: number };
  };

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }).setSystemTime(NOW);
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Message, Session],
      synchronize: true,
    });
    await ds.initialize();
    await ds
      .getRepository(Session)
      .save({ name: 'bot', id: 's1', createdAt: new Date(NOW.getTime() - 40 * 86_400_000) });
    for (const chatId of KNOWN) {
      await ds.query(
        `INSERT INTO "messages" ("id","sessionId","chatId","from","to","type","direction","createdAt")
         VALUES (?,'s1',?,'a','b','text','incoming',?)`,
        [`seed-${chatId}`, chatId, new Date(NOW.getTime() - 5 * 86_400_000).toISOString()],
      );
    }
  });

  afterEach(async () => {
    jest.useRealTimers();
    await ds.destroy();
  });

  const run = async (
    seed: number,
    opts: Run,
  ): Promise<{ service: SendPacingService; inflight: InFlight[]; violations: string[] }> => {
    const r = rng(seed);
    const service = build(opts);
    const inflight: InFlight[] = [];
    const violations: string[] = [];
    let probes = 0;
    const chat = (): string => (r() < 0.5 ? KNOWN[Math.floor(r() * 4)] : `cold${Math.floor(r() * 30)}@c.us`);
    const drop = (f: InFlight): void => void inflight.splice(inflight.indexOf(f), 1);
    const land = async (f: InFlight): Promise<void> => {
      await insertRow(f.chatId);
      drop(f);
    };

    const checkCaps = async (where: string): Promise<void> => {
      const rows = await rowsToday();
      if (rows + inflight.length > opts.daily) {
        violations.push(`${where}: ${rows} rows + ${inflight.length} due > ${opts.daily}`);
      }
      if (!opts.cold) return;
      const cold = await coldRowsToday();
      const due = new Set(inflight.map(f => f.chatId).filter(c => c.startsWith('cold') && !cold.has(c)));
      if (cold.size + due.size > opts.cold) {
        violations.push(`${where}: ${cold.size} cold + ${due.size} due > ${opts.cold}`);
      }
    };

    for (let s = 0; s < opts.steps; s++) {
      const x = r();
      if (x < 0.3) {
        // A parallel burst of one to three sends, with a row landing alongside half the time.
        const n = 1 + Math.floor(r() * 3);
        const landing = inflight.find(f => f.kind === 'single');
        const concurrentRow = landing && r() < 0.5 ? land(landing) : Promise.resolve();
        const burst = Array.from({ length: n }, async () => {
          const kind: InFlight['kind'] = r() < 0.5 ? 'single' : 'bulk';
          const chatId = chat();
          try {
            const settle = await service.assertSendAllowed('s1', chatId, { untilSettled: kind === 'bulk' });
            inflight.push({ kind, chatId, settle, settled: false, at: Date.now() });
          } catch (error) {
            if (!(refusal(error).retryAfterSeconds >= 1)) violations.push(`step ${s}: hint below 1 s`);
          }
        });
        await Promise.all([...burst, concurrentRow]);
      } else if (x < 0.5 && inflight.length) {
        const f = inflight[Math.floor(r() * inflight.length)];
        const y = r();
        if (y < 0.15 && !f.settled) {
          // Failed before WhatsApp could have taken it: handed back, no row.
          f.settle?.();
          drop(f);
        } else if (f.kind === 'single' || f.settled) {
          await land(f);
        } else if (opts.unknown && y < 0.25) {
          f.settle?.(true);
          drop(f);
        } else {
          f.settle?.(true);
          f.settled = true;
          f.at = Date.now();
        }
      } else {
        // Time passes. A single send's row lands inside its window, a settled one's inside a window of its
        // settle, and a bulk item in flight settles well inside the safety bound.
        const dt = Math.floor(r() * 4_000);
        for (const f of [...inflight]) {
          const due = f.kind === 'single' || f.settled ? f.at + 9_000 : f.at + 290_000;
          if (due > Date.now() + dt) continue;
          if (f.settled || f.kind === 'single') {
            await land(f);
          } else {
            f.settle?.(true);
            f.settled = true;
            f.at = Date.now();
          }
        }
        jest.setSystemTime(Date.now() + dt);
      }
      await checkCaps(`step ${s}`);

      if (s % 7 === 6) {
        for (const f of inflight.filter(i => i.kind === 'single' || i.settled)) await land(f);
        await checkCaps(`flush ${s}`);
        if (!opts.unknown && inflight.length === 0) {
          // Every admitted send has its row: the caps must read the rows alone, no more.
          const rows = await rowsToday();
          const ok = await service.assertSendAllowed('s1', KNOWN[1], { hold: false }).then(
            () => true,
            () => false,
          );
          if (ok !== rows < opts.daily) violations.push(`probe ${s}: ${rows} rows, allowed ${ok}`);
          const cold = (await coldRowsToday()).size;
          if (opts.cold && rows < opts.daily) {
            const coldOk = await service.assertSendAllowed('s1', `probe${probes++}@c.us`, { hold: false }).then(
              () => true,
              () => false,
            );
            if (coldOk !== cold < opts.cold) violations.push(`cold probe ${s}: ${cold} cold, allowed ${coldOk}`);
          }
        }
      }
    }
    return { service, inflight, violations };
  };

  /**
   * Bring every send still running to an end with its row, then send to a known chat every 3 s for 30 s and
   * probe the cold cap: by then every cold send's own window has ended, so it must read the cold rows alone,
   * the unknown outcomes that never wrote one included.
   */
  const warmTail = async (service: SendPacingService, inflight: InFlight[], opts: Run): Promise<string[]> => {
    for (const f of inflight) {
      if (!f.settled) f.settle?.(true);
      await insertRow(f.chatId);
    }
    for (let t = 1; t <= 10; t++) {
      jest.setSystemTime(Date.now() + 3_000);
      await service.assertSendAllowed('s1', KNOWN[0]);
      await insertRow(KNOWN[0]);
    }
    const cold = (await coldRowsToday()).size;
    const ok = await service.assertSendAllowed('s1', 'tail@c.us', { hold: false }).then(
      () => true,
      () => false,
    );
    return ok === cold < opts.cold ? [] : [`after warm traffic: ${cold} cold of ${opts.cold}, allowed ${ok}`];
  };

  const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

  it.each(SEEDS)('passes no cap with unknown outcomes, seed %i', async seed => {
    const { violations } = await run(seed, { daily: 12, cold: 4, steps: 120, unknown: true });
    expect(violations).toEqual([]);
  });

  it.each(SEEDS)('counts nothing twice once every row has landed, seed %i', async seed => {
    const { violations } = await run(seed, { daily: 12, cold: 4, steps: 150, unknown: false });
    expect(violations).toEqual([]);
  });

  it.each(SEEDS)('stops counting a cold send with no row once warm sends are all that arrive, seed %i', async seed => {
    const opts: Run = { daily: 1_000, cold: 8, steps: 60, unknown: true };
    const { service, inflight, violations } = await run(seed, opts);
    expect([...violations, ...(await warmTail(service, inflight, opts))]).toEqual([]);
  });
});
