import { plainToInstance } from 'class-transformer';
import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface, validateSync } from 'class-validator';
import { UpdateSessionConfigDto } from './session-config.dto';

const RECOGNISED_KEYS = ['autoRejectCalls', 'maxReconnectAttempts', 'reconnectBaseDelay'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The recognised keys the caller sent, through UpdateSessionConfigDto's strict coercions. */
function recognisedKeys(config: Record<string, unknown>): UpdateSessionConfigDto {
  const sent = Object.fromEntries(RECOGNISED_KEYS.filter(key => key in config).map(key => [key, config[key]]));
  return plainToInstance(UpdateSessionConfigDto, sent);
}

/**
 * The create body's `config`, with the three keys the session reads coerced exactly as PATCH /config
 * coerces them (`"true"` to `true`, `"5"` to `5`), so a value that route accepts is stored typed.
 * Unknown keys are kept as sent: they are stored but ignored. A non-object is left for `@IsObject`.
 */
export function normaliseSessionConfig(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const coerced = recognisedKeys(value);
  const normalised = { ...value };
  for (const key of RECOGNISED_KEYS) if (key in value) normalised[key] = coerced[key];
  return normalised;
}

function configErrors(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return validateSync(recognisedKeys(value))
    .flatMap(error => Object.values(error.constraints ?? {}))
    .map(message => `config.${message}`);
}

/**
 * Hold the create route's `config` to the rules PATCH /config enforces on the same three keys. Without
 * it the values were stored as sent and clamped at start time without a word: `-1` or `0.5` turned
 * reconnect off, `50` became `20`, and `"yes"` left autoRejectCalls off.
 */
@ValidatorConstraint({ name: 'isRecognisedSessionConfig', async: false })
export class RecognisedSessionConfigConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return configErrors(value).length === 0;
  }
  defaultMessage(args: ValidationArguments): string {
    return configErrors(args.value).join('; ');
  }
}
