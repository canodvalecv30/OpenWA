import type { Server } from 'http';
import { INestApplication, Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

describe('MetricsController', () => {
  let app: INestApplication;
  let warn: jest.SpyInstance;
  const metricsService = { assertScrapeAuthorized: jest.fn(), render: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [{ provide: MetricsService, useValue: metricsService }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    metricsService.assertScrapeAuthorized.mockReset();
    metricsService.render.mockReset().mockResolvedValue('openwa_up 1\n');
  });

  afterEach(() => warn.mockRestore());

  afterAll(async () => {
    await app.close();
  });

  it('answers a scrape with Prometheus text that is never cached', async () => {
    const res = await request(app.getHttpServer() as Server).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['content-type']).toContain('version=0.0.4');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toBe('openwa_up 1\n');
  });

  it('answers a refused scrape as JSON without logging a content-type warning', async () => {
    metricsService.assertScrapeAuthorized.mockImplementation(() => {
      throw new NotFoundException();
    });
    const res = await request(app.getHttpServer() as Server).get('/metrics');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(warn).not.toHaveBeenCalled();
    expect(metricsService.render).not.toHaveBeenCalled();
  });
});
