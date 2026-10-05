import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shapes for the settings routes — the raw handler value, no envelope.
 * Decorated properties avoid named utility types: emitDecoratorMetadata wraps a named type in a
 * runtime guard whose other arm can never execute, leaving an uncoverable branch.
 */

export class SettingsGeneralDto {
  @ApiProperty({
    description: 'The advertised base URL (BASE_URL), the same value the startup banner and ingress URLs use.',
    example: 'https://wa.example.com',
  })
  apiBaseUrl!: string;

  @ApiProperty({
    description:
      'Always true: the engine auto-reconnects on a transient disconnect and there is no global off ' +
      'switch. Attempts are unlimited by default; cap them per session with config.maxReconnectAttempts ' +
      '(0-20, PATCH /api/sessions/{sessionId}/config). The cap bounds every reconnect on whatsapp-web.js; ' +
      'on Baileys it bounds only the reconnect after a logged-out close, and the engine retries a transient ' +
      'drop itself with no cap.',
    example: true,
  })
  autoReconnect!: boolean;

  @ApiProperty({ description: 'Whether database query logging is on.', example: false })
  debugMode!: boolean;
}

export class SettingsApiDto {
  @ApiProperty({ description: 'Requests allowed per window.', example: 100 })
  rateLimit!: number;

  @ApiProperty({ description: 'Window length in milliseconds.', example: 60000 })
  rateLimitWindow!: number;

  @ApiProperty({ description: 'Whether Swagger is actually served — off by default in production.', example: false })
  enableDocs!: boolean;
}

const NOTIFICATION_PLACEHOLDER =
  'Fixed placeholder: no notification feature exists, and the value is not configurable.';

export class SettingsNotificationsDto {
  @ApiProperty({ description: `Always false. ${NOTIFICATION_PLACEHOLDER}`, example: false }) emailEnabled!: boolean;
  @ApiProperty({ description: `Always empty. ${NOTIFICATION_PLACEHOLDER}`, example: '' }) notificationEmail!: string;
  @ApiProperty({ description: `Always false. ${NOTIFICATION_PLACEHOLDER}`, example: false }) webhookAlerts!: boolean;
}

export class SettingsResponseDto {
  @ApiProperty({ type: SettingsGeneralDto })
  general!: SettingsGeneralDto;

  @ApiProperty({ type: SettingsApiDto })
  api!: SettingsApiDto;

  @ApiProperty({ type: SettingsNotificationsDto })
  notifications!: SettingsNotificationsDto;
}
