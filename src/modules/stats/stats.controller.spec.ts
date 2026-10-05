import { Reflector } from '@nestjs/core';
import { StatsController } from './stats.controller';
import { REQUIRED_ROLE_KEY, UNSCOPED_KEY } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

// the global stats routes aggregate across EVERY session and carry no scope param, so the
// ApiKeyGuard's allowedSessions fence doesn't apply. They require ADMIN to keep VIEWER/OPERATOR keys
// out, and @RequireUnscopedKey to keep a session-restricted key out: role and session scope are
// independent, so ADMIN alone does not do that. The per-session route is left ungated: it carries
// :sessionId, so the guard already scopes a restricted key to its own sessions.
describe('StatsController access control', () => {
  const reflector = new Reflector();
  // Opaque-object view of the prototype so the lint unbound-method rule doesn't fire on a
  // metadata-only handler lookup.
  const proto = StatsController.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

  it.each(['getOverview', 'getMessageStats'] as const)('global stats route %s requires ADMIN', method => {
    const role = reflector.get<ApiKeyRole | undefined>(REQUIRED_ROLE_KEY, proto[method]);
    expect(role).toBe(ApiKeyRole.ADMIN);
  });

  it.each(['getOverview', 'getMessageStats'] as const)('global stats route %s requires an unscoped key', method => {
    expect(reflector.get<boolean | undefined>(UNSCOPED_KEY, proto[method])).toBe(true);
  });

  it('per-session stats is not globally ADMIN-gated (scope-enforced by its :sessionId param)', () => {
    const role = reflector.get<ApiKeyRole | undefined>(REQUIRED_ROLE_KEY, proto.getSessionStats);
    expect(role).toBeUndefined();
  });
});
