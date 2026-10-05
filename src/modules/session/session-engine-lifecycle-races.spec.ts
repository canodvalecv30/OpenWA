import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { SessionStoppedException } from './session-engine-controls';
import { ConfigService } from '@nestjs/config';
import { SessionService } from './session.service';
import { SessionEngineLifecycle, type ReconnectState } from './session-engine-lifecycle.service';
import { SessionErrorStore } from './session-error-store.service';
import { SessionRestrictionStore } from './session-restriction-store.service';
import { PresenceStore } from './presence-store.service';
import { Session, SessionStatus } from './entities/session.entity';
import { Message } from '../message/entities/message.entity';
import { EngineFactory } from '../../engine/engine.factory';
import { EngineRegistry } from '../../engine/engine-registry.service';
import { SessionLidResolver } from './session-lid-resolver.service';
import { SessionLivenessWatchdog } from './session-liveness-watchdog.service';
import { MessageProjector } from './message-projector.service';
import { LidMappingStoreService } from '../../engine/identity/lid-mapping-store.service';
import { EventsGateway } from '../events/events.gateway';
import { WebhookService } from '../webhook/webhook.service';
import { HookManager } from '../../core/hooks';
import { StatusStoreService } from '../status-store/status-store.service';
import { EngineStatus, type EngineEventCallbacks } from '../../engine/interfaces/whatsapp-engine.interface';

const ID = 'sess-uuid-1';
const NAME = 'test-session';

const session = (overrides: Partial<Session> = {}): Session => ({
  id: ID,
  name: NAME,
  status: SessionStatus.CREATED,
  phone: null,
  pushName: null,
  config: {},
  proxyUrl: null,
  proxyType: null,
  connectedAt: null,
  lastActiveAt: null,
  nodeId: null,
  claimedAt: null,
  leaseExpiresAt: null,
  desiredState: null,
  nodeUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeEngine = (): Record<string, jest.Mock> => ({
  initialize: jest.fn().mockResolvedValue(undefined),
  destroy: jest.fn().mockResolvedValue(undefined),
  forceDestroy: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  logout: jest.fn().mockResolvedValue(undefined),
  getQRCode: jest.fn().mockReturnValue(null),
});

/** A promise the test settles by hand. */
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
};

interface Internals {
  engines: EngineRegistry;
  reconnectStates: Map<string, ReconnectState>;
  logger: { warn: (...args: unknown[]) => void };
  executeReconnect(id: string, session: Session, state: ReconnectState): Promise<void>;
  scheduleReconnect(id: string, session: Session): void;
  handleEngineReady(id: string, engine: unknown, phone: string, pushName: string): void;
  rejectRebind(id: string, engine: unknown, name: string, previous: string, incoming: string): Promise<void>;
}

describe('SessionEngineLifecycle races', () => {
  let lifecycle: SessionEngineLifecycle;
  let internals: Internals;
  let repository: { findOne: jest.Mock; update: jest.Mock; exists: jest.Mock };
  let engineFactory: { create: jest.Mock; purgeSessionData: jest.Mock };
  let config: Record<string, unknown>;

  beforeEach(async () => {
    config = {};
    repository = {
      findOne: jest.fn().mockResolvedValue(session()),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      exists: jest.fn().mockResolvedValue(false),
    };
    engineFactory = {
      create: jest.fn().mockImplementation(() => makeEngine()),
      purgeSessionData: jest.fn().mockResolvedValue(undefined),
    };
    const module = await Test.createTestingModule({
      providers: [
        SessionService,
        SessionEngineLifecycle,
        SessionErrorStore,
        SessionRestrictionStore,
        PresenceStore,
        { provide: getRepositoryToken(Session, 'data'), useValue: repository },
        { provide: getRepositoryToken(Message, 'data'), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getDataSourceToken('data'), useValue: {} },
        { provide: EngineFactory, useValue: engineFactory },
        EngineRegistry,
        SessionLidResolver,
        SessionLivenessWatchdog,
        MessageProjector,
        {
          provide: EventsGateway,
          useValue: {
            emitSessionStatus: jest.fn(),
            emitSessionDisconnected: jest.fn(),
            emitQRCode: jest.fn(),
            emitSessionAuthenticated: jest.fn(),
          },
        },
        { provide: WebhookService, useValue: { dispatch: jest.fn().mockResolvedValue(undefined) } },
        { provide: HookManager, useValue: { execute: jest.fn().mockResolvedValue({ continue: true, data: {} }) } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(<T>(key: string, def?: T): T => (key in config ? (config[key] as T) : (def as T))) },
        },
        { provide: LidMappingStoreService, useValue: { remember: jest.fn() } },
        { provide: StatusStoreService, useValue: { ingest: jest.fn() } },
      ],
    }).compile();
    lifecycle = module.get(SessionEngineLifecycle);
    internals = lifecycle as unknown as Internals;
  });

  afterEach(() => {
    for (const state of internals.reconnectStates.values()) if (state.timer) clearTimeout(state.timer);
  });

  describe('MAX_CONCURRENT_SESSIONS', () => {
    it('counts a session waiting out a failed relaunch, which holds no engine', async () => {
      config['sessions.maxConcurrent'] = 1;
      const timer = setTimeout(() => undefined, 60_000);
      internals.reconnectStates.set('other', { attempts: 1, timer, maxAttempts: 5, baseDelay: 5000 });

      await expect(lifecycle.start(ID)).rejects.toThrow(
        new BadRequestException('Maximum concurrent sessions reached (1)'),
      );
      expect(engineFactory.create).not.toHaveBeenCalled();
    });

    it('does not count the reconnect state of the session being started', async () => {
      config['sessions.maxConcurrent'] = 1;
      const timer = setTimeout(() => undefined, 60_000);
      internals.reconnectStates.set(ID, { attempts: 1, timer, maxAttempts: 5, baseDelay: 5000 });

      await lifecycle.start(ID);

      expect(internals.engines.has(ID)).toBe(true);
    });
  });

  describe('stopOrphanEngines against a start still reading its row', () => {
    it('retires the start instead of letting it clear the stop mark', async () => {
      const read = deferred<Session>();
      repository.findOne.mockReturnValueOnce(read.promise);

      const starting = lifecycle.start(ID);
      const outcome = starting.then(
        () => undefined,
        (e: unknown) => e,
      );
      await flush();
      await expect(lifecycle.stopOrphanEngines([ID])).resolves.toEqual({
        stopped: [],
        notRunning: [ID],
        failed: [],
      });
      read.resolve(session());

      expect(await outcome).toBeInstanceOf(SessionStoppedException);
      expect(engineFactory.create).not.toHaveBeenCalled();
      expect(internals.engines.has(ID)).toBe(false);
    });

    it('still clears a stop mark left from before the start began', async () => {
      await lifecycle.stopOrphanEngines([ID]);

      await lifecycle.start(ID);

      expect(internals.engines.has(ID)).toBe(true);
    });

    it('retires the start when an older stop mark was already present', async () => {
      await lifecycle.stopOrphanEngines([ID]);
      const read = deferred<Session>();
      repository.findOne.mockReturnValueOnce(read.promise);

      const outcome = lifecycle.start(ID).then(
        () => undefined,
        (e: unknown) => e,
      );
      await flush();
      await expect(lifecycle.stopOrphanEngines([ID])).resolves.toEqual({
        stopped: [],
        notRunning: [ID],
        failed: [],
      });
      read.resolve(session());

      expect(await outcome).toBeInstanceOf(SessionStoppedException);
      expect(engineFactory.create).not.toHaveBeenCalled();
    });
  });

  describe('stop against an explicit start still reading its row', () => {
    it('yields to a stop that lands while it waits, after an earlier stop', async () => {
      repository.findOne.mockResolvedValue(session({ desiredState: 'stopped' }));
      await lifecycle.stop(ID);
      const read = deferred<Session>();
      repository.findOne.mockReturnValueOnce(read.promise);

      const outcome = lifecycle.start(ID, { explicit: true }).then(
        () => undefined,
        (e: unknown) => e,
      );
      await flush();
      await lifecycle.stop(ID);
      read.resolve(session({ desiredState: 'stopped' }));

      expect(await outcome).toBeInstanceOf(SessionStoppedException);
      expect(internals.engines.has(ID)).toBe(false);
    });
  });

  describe('rejectRebind', () => {
    const failedWrites = (): number =>
      repository.update.mock.calls.filter(
        ([, patch]) => (patch as { status?: unknown }).status === SessionStatus.FAILED,
      ).length;

    it("retires the refused account's engine before its logout runs", async () => {
      const logout = deferred();
      const engine = { ...makeEngine(), logout: jest.fn().mockReturnValue(logout.promise) };
      internals.engines.set(ID, engine as never);

      const rejecting = internals.rejectRebind(ID, engine, NAME, '628111', '628999');
      await flush();

      // Every inbound callback is gated on this, so nothing the refused account sends while the
      // logout runs is stored or dispatched under this session.
      expect(engine.logout).toHaveBeenCalledTimes(1);
      expect(internals.engines.isLive(ID, engine as never)).toBe(false);

      logout.resolve();
      await rejecting;
      expect(failedWrites()).toBe(1);
    });

    it('leaves a start that registered an engine during the logout alone', async () => {
      const logout = deferred();
      const engine = { ...makeEngine(), logout: jest.fn().mockReturnValue(logout.promise) };
      const replacement = makeEngine();
      internals.engines.set(ID, engine as never);

      const rejecting = internals.rejectRebind(ID, engine, NAME, '628111', '628999');
      await flush();
      internals.engines.set(ID, replacement as never);
      logout.resolve();
      await rejecting;

      expect(internals.engines.get(ID)).toBe(replacement);
      expect(failedWrites()).toBe(0);
    });
  });

  describe('stop hooks', () => {
    it('records the stop after the session read and before the teardown', async () => {
      await lifecycle.start(ID);
      const engine = (engineFactory.create.mock.results[0] as { value: Record<string, jest.Mock> }).value;
      const order: string[] = [];
      repository.findOne.mockImplementationOnce(() => {
        order.push('read');
        return Promise.resolve(session());
      });
      engine.disconnect.mockImplementation(() => {
        order.push('teardown');
        return Promise.resolve();
      });

      await lifecycle.stop(ID, {
        afterRead: () => {
          order.push('record');
          return Promise.resolve();
        },
      });

      expect(order).toEqual(['read', 'record', 'teardown']);
    });

    it('takes nothing down when recording the stop fails', async () => {
      await lifecycle.start(ID);
      const engine = (engineFactory.create.mock.results[0] as { value: Record<string, jest.Mock> }).value;

      await expect(lifecycle.stop(ID, { afterRead: () => Promise.reject(new Error('SQLITE_BUSY')) })).rejects.toThrow(
        'SQLITE_BUSY',
      );

      expect(engine.disconnect).not.toHaveBeenCalled();
      expect(internals.engines.has(ID)).toBe(true);
    });

    it.each([
      [
        'stop',
        (onReadFailed: () => void, afterRead: () => Promise<void>) => lifecycle.stop(ID, { afterRead, onReadFailed }),
      ],
      ['delete', (onReadFailed: () => void) => lifecycle.delete(ID, { onReadFailed })],
    ])('%s() reports a failed session read and records nothing', async (_verb, call) => {
      const onReadFailed = jest.fn();
      const afterRead = jest.fn().mockResolvedValue(undefined);
      repository.findOne.mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));

      await expect(call(onReadFailed, afterRead)).rejects.toThrow('Connection terminated unexpectedly');

      expect(onReadFailed).toHaveBeenCalledTimes(1);
      expect(afterRead).not.toHaveBeenCalled();
    });
  });

  describe('engine-driven status writes', () => {
    const rejectStatus = (status: SessionStatus): void => {
      repository.update.mockImplementation((_id: unknown, patch: { status?: unknown }) =>
        patch.status === status ? Promise.reject(new Error('SQLITE_BUSY')) : Promise.resolve({ affected: 1 }),
      );
    };

    it('logs a failed DISCONNECTED write instead of leaving it unhandled', async () => {
      const warn = jest.spyOn(internals.logger, 'warn');
      rejectStatus(SessionStatus.DISCONNECTED);
      const engine = makeEngine();
      internals.engines.set(ID, engine as never);

      await lifecycle.handleEngineDisconnected(ID, engine as never, 'NAVIGATION');
      await flush();

      expect(warn).toHaveBeenCalledWith('Failed to persist the disconnected status', {
        sessionId: ID,
        error: 'SQLITE_BUSY',
      });
    });

    it('logs a failed write of a status the engine reported', async () => {
      const warn = jest.spyOn(internals.logger, 'warn');
      await lifecycle.start(ID);
      const engine = (engineFactory.create.mock.results[0] as { value: Record<string, jest.Mock> }).value;
      const callbacks = (engine.initialize.mock.calls as [EngineEventCallbacks][])[0][0];
      rejectStatus(SessionStatus.AUTHENTICATING);

      callbacks.onStateChanged?.(EngineStatus.AUTHENTICATING);
      await flush();

      expect(warn).toHaveBeenCalledWith('Failed to persist an engine status', {
        sessionId: ID,
        status: SessionStatus.AUTHENTICATING,
        error: 'SQLITE_BUSY',
      });
    });

    it('logs a failed FAILED write when reconnect attempts run out', async () => {
      const warn = jest.spyOn(internals.logger, 'warn');
      rejectStatus(SessionStatus.FAILED);
      internals.reconnectStates.set(ID, { attempts: 5, timer: null, maxAttempts: 5, baseDelay: 5000 });

      internals.scheduleReconnect(ID, session());
      await flush();

      expect(warn).toHaveBeenCalledWith('Failed to persist the reconnect-exhausted FAILED state', {
        sessionId: ID,
        error: 'SQLITE_BUSY',
      });
    });
  });

  describe('a reconnect attempt failing while the next one tears its engine down', () => {
    it('leaves the episode to the later attempt instead of arming another over it', async () => {
      const state: ReconnectState = { attempts: 1, timer: null, maxAttempts: 5, baseDelay: 5000 };
      internals.reconnectStates.set(ID, state);
      const initA = deferred();
      const destroyA = deferred();
      const engineA = {
        ...makeEngine(),
        initialize: jest.fn().mockReturnValue(initA.promise),
        destroy: jest.fn().mockReturnValue(destroyA.promise),
      };
      const engineB = makeEngine();
      engineFactory.create.mockReturnValueOnce(engineA).mockReturnValueOnce(engineB);

      const attemptA = internals.executeReconnect(ID, session(), state);
      await flush();
      expect(internals.engines.get(ID)).toBe(engineA);

      // Engine A drops mid-init: the next attempt is armed and fires, then waits on A's destroy.
      internals.scheduleReconnect(ID, session());
      clearTimeout(state.timer!);
      state.timer = null;
      const attemptB = internals.executeReconnect(ID, session(), state);
      await flush();

      // Closing A is what makes its pending initialize() reject, before B has registered anything.
      initA.reject(new Error('Target closed'));
      await attemptA;
      expect(state.timer).toBeNull();

      destroyA.resolve();
      await attemptB;
      await flush();

      expect(internals.engines.get(ID)).toBe(engineB);
      expect(state.timer).toBeNull();
      expect(engineFactory.create).toHaveBeenCalledTimes(2);
    });

    it('re-arms when the attempt armed after it was cancelled by a READY before it fired', async () => {
      const state: ReconnectState = { attempts: 1, timer: null, maxAttempts: 5, baseDelay: 5000 };
      internals.reconnectStates.set(ID, state);
      const initA = deferred();
      const engineA = { ...makeEngine(), initialize: jest.fn().mockReturnValue(initA.promise) };
      engineFactory.create.mockReturnValueOnce(engineA);

      const attemptA = internals.executeReconnect(ID, session(), state);
      await flush();
      expect(internals.engines.get(ID)).toBe(engineA);

      // Engine A drops mid-init and arms the next attempt, then reaches READY, which cancels that timer.
      internals.scheduleReconnect(ID, session());
      expect(state.timer).not.toBeNull();
      internals.handleEngineReady(ID, engineA, '628111', 'Push');
      expect(state.timer).toBeNull();

      // A's init still rejects afterwards: nothing else owns the episode, so A must arm a recovery.
      initA.reject(new Error('Engine initialization timed out'));
      await attemptA;

      expect(internals.engines.has(ID)).toBe(false);
      expect(state.timer).not.toBeNull();
    });
  });
});
