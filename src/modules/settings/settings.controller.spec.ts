import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SettingsController } from './settings.controller';
import { REQUIRED_ROLE_KEY } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

// ConfigService stub: return the supplied default for every key.
const configStub = {
  get: <T>(_key: string, def?: T): T | undefined => def,
} as unknown as ConfigService;

describe('SettingsController', () => {
  it('GET /settings returns the environment-derived settings', () => {
    const settings = new SettingsController(configStub).get();
    expect(settings).toHaveProperty('general');
    expect(settings.general).not.toHaveProperty('sessionTimeout');
    expect(settings).toHaveProperty('api');
    expect(settings).toHaveProperty('notifications');
  });

  it('reads the rate limit, debug flag and port from the keys the app configures', () => {
    const prev = process.env.BASE_URL;
    try {
      delete process.env.BASE_URL;
      const config = new ConfigService({
        port: 9999,
        database: { logging: true },
        api: { rateLimit: { mediumLimit: 7, mediumTtl: 1234 } },
      });
      const settings = new SettingsController(config).get();
      expect(settings.api.rateLimit).toBe(7);
      expect(settings.api.rateLimitWindow).toBe(1234);
      expect(settings.general.debugMode).toBe(true);
      expect(settings.general.apiBaseUrl).toBe('http://localhost:9999');
    } finally {
      if (prev !== undefined) process.env.BASE_URL = prev;
    }
  });

  it('reports no notification feature as enabled, since none exists', () => {
    expect(new SettingsController(configStub).get().notifications).toEqual({
      emailEnabled: false,
      notificationEmail: '',
      webhookAlerts: false,
    });
  });

  it('reports enableDocs from the real ENABLE_SWAGGER gate, not a hardcoded true', () => {
    const prev = process.env.ENABLE_SWAGGER;
    try {
      process.env.ENABLE_SWAGGER = 'false';
      expect(new SettingsController(configStub).get().api.enableDocs).toBe(false);
      process.env.ENABLE_SWAGGER = 'true';
      expect(new SettingsController(configStub).get().api.enableDocs).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ENABLE_SWAGGER;
      else process.env.ENABLE_SWAGGER = prev;
    }
  });

  it('reports apiBaseUrl from BASE_URL when the operator configured one', () => {
    const prev = process.env.BASE_URL;
    try {
      process.env.BASE_URL = 'https://wa.example.com';
      expect(new SettingsController(configStub).get().general.apiBaseUrl).toBe('https://wa.example.com');
    } finally {
      if (prev === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = prev;
    }
  });

  it('GET /settings requires the ADMIN role (env-derived config is not for low-privilege keys)', () => {
    const proto = SettingsController.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
    const role = new Reflector().get<ApiKeyRole | undefined>(REQUIRED_ROLE_KEY, proto.get);
    expect(role).toBe(ApiKeyRole.ADMIN);
  });
});
