import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_OPTIONS } from '../../config/app-validation';
import { CreateApiKeyDto, UpdateApiKeyDto } from '../../modules/auth/dto/api-key.dto';
import { CreateAutomationRuleDto, UpdateAutomationRuleDto } from '../../modules/automation/dto/automation-rule.dto';
import { CreateSessionDto } from '../../modules/session/dto/create-session.dto';
import { UpdateSessionProxyDto } from '../../modules/session/dto/session-proxy.dto';
import { CreateWebhookDto, UpdateWebhookDto } from '../../modules/webhook/dto/webhook.dto';

// Each field lands in a varchar(n) column, which PostgreSQL counts in code points. @MaxLength folds a
// presentation selector (U+FE0F) into the character before it, so a value of up to 2n code points
// passed validation and the INSERT failed as a 500.
describe('varchar-backed fields are bounded in code points', () => {
  const pipe = new ValidationPipe(GLOBAL_VALIDATION_OPTIONS);
  const emoji = '✔️';
  const url = 'https://example.com/';
  const proxy = (pad: string): string => `http://user:${pad}@proxy.example.com:8080`;

  it.each([
    ['automation rule create name', CreateAutomationRuleDto, { replyText: 'hi' }, 'name', 100, (p: string) => p],
    ['automation rule update name', UpdateAutomationRuleDto, {}, 'name', 100, (p: string) => p],
    ['API key create name', CreateApiKeyDto, {}, 'name', 100, (p: string) => p],
    ['API key update name', UpdateApiKeyDto, {}, 'name', 100, (p: string) => p],
    ['webhook create secret', CreateWebhookDto, { url }, 'secret', 255, (p: string) => p],
    ['webhook update secret', UpdateWebhookDto, {}, 'secret', 255, (p: string) => p],
    ['webhook create url', CreateWebhookDto, {}, 'url', 2048 - url.length, (p: string) => url + p],
    ['webhook update url', UpdateWebhookDto, {}, 'url', 2048 - url.length, (p: string) => url + p],
    ['session create proxyUrl', CreateSessionDto, { name: 'bot' }, 'proxyUrl', 255 - proxy('').length, proxy],
    ['session proxy update proxyUrl', UpdateSessionProxyDto, {}, 'proxyUrl', 255 - proxy('').length, proxy],
  ])('%s', async (_label, metatype, rest, field, room, wrap) => {
    const through = (pad: string): Promise<unknown> =>
      pipe.transform({ ...rest, [field]: wrap(pad) }, { type: 'body', metatype });
    const half = Math.floor(room / 2);
    await expect(through(emoji.repeat(half + 1))).rejects.toBeInstanceOf(BadRequestException);
    await expect(through(emoji.repeat(half))).resolves.toMatchObject({ [field]: wrap(emoji.repeat(half)) });
    await expect(through('a'.repeat(room))).resolves.toMatchObject({ [field]: wrap('a'.repeat(room)) });
    await expect(through('a'.repeat(room + 1))).rejects.toBeInstanceOf(BadRequestException);
  });
});
