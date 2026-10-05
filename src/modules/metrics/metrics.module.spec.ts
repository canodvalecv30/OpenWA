import type { Server } from 'http';
import { INestApplication, Logger, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MetricsModule } from './metrics.module';
import { requestMetricsBoundaryMiddleware } from '../../common/middleware/request-metrics.middleware';

jest.mock('../../common/middleware/request-metrics.middleware', () => ({
  requestMetricsBoundaryMiddleware: jest.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

// MetricsModule's own imports need a database; only its middleware binding is under test, so a bare
// module borrows that `configure`.
@Module({})
class BoundaryOnlyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    MetricsModule.prototype.configure.call(this, consumer);
  }
}

describe('MetricsModule request-metrics boundary', () => {
  let app: INestApplication;
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({ imports: [BoundaryOnlyModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    warn.mockRestore();
    await app.close();
  });

  it('binds without the legacy-wildcard warning Nest prints for an unnamed `*`', () => {
    const messages = (warn.mock.calls as unknown[][]).map(call => String(call[0]));
    expect(messages.filter(m => m.includes('Unsupported route path'))).toEqual([]);
  });

  it('still runs for every /api route and nothing outside it', async () => {
    const boundary = jest.mocked(requestMetricsBoundaryMiddleware);
    const hits = async (path: string): Promise<number> => {
      boundary.mockClear();
      await request(app.getHttpServer() as Server).get(path);
      return boundary.mock.calls.length;
    };
    expect(await hits('/api/x')).toBe(1);
    expect(await hits('/api/nope/deep')).toBe(1);
    expect(await hits('/other')).toBe(0);
  });
});
