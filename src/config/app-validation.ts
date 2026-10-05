import {
  ArgumentMetadata,
  BadRequestException,
  INestApplication,
  PipeTransform,
  ValidationPipe,
  ValidationPipeOptions,
} from '@nestjs/common';
import { isValidationErrorDetailEnabled } from './bootstrap-security';
import { containsNul } from '../common/validation/no-nul-character';
import { ImportDataDto } from '../modules/infra/dto/import-data.dto';

/**
 * The DTO validation contract itself, without the one option that depends on the environment.
 *
 * Exported so a spec can construct the real pipe from the same object production uses instead of
 * restating the options as literals. A restated copy is a mirror, and a mirror can drift: loosening
 * `whitelist` here would leave every spec that hardcoded `whitelist: true` still asserting the old
 * contract, green, while the running app no longer honours it. Reading one object makes production
 * and the specs unable to disagree — and turns those specs into a gate over this file.
 *
 * `disableErrorMessages` is deliberately NOT here: it is resolved from the environment at call time,
 * so it is not part of the contract a spec should reproduce.
 */
export const GLOBAL_VALIDATION_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
};

/**
 * Refuses a request body holding U+0000 anywhere. PostgreSQL rejects it in every text and varchar value
 * and bound parameter, so it failed the lookup or write behind the route as a 500 while SQLite took it.
 * The restore is exempt: a SQLite backup may hold one in a message, and the importers drop it from the
 * same free-text columns the entities clean.
 */
export class NulBodyPipe implements PipeTransform {
  transform(value: unknown, { type, metatype }: ArgumentMetadata): unknown {
    if (type === 'body' && metatype !== ImportDataDto && containsNul(value)) {
      throw new BadRequestException('Request body must not contain a NUL character');
    }
    return value;
  }
}

/** Apply the HTTP prefix and DTO validation contract shared by production and e2e applications. */
export function applyGlobalValidation(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      ...GLOBAL_VALIDATION_OPTIONS,
      disableErrorMessages: !isValidationErrorDetailEnabled(process.env.VALIDATION_ERROR_DETAIL, process.env.NODE_ENV),
    }),
    new NulBodyPipe(),
  );
}
