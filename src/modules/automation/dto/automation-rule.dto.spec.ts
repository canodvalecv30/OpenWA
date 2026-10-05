import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateAutomationRuleDto, UpdateAutomationRuleDto } from './automation-rule.dto';
import { GLOBAL_VALIDATION_OPTIONS } from '../../../config/app-validation';

describe('UpdateAutomationRuleDto', () => {
  const pipe = new ValidationPipe(GLOBAL_VALIDATION_OPTIONS);
  const through = (value: object): Promise<unknown> =>
    pipe.transform(value, { type: 'body', metatype: UpdateAutomationRuleDto });

  // These four columns are NOT NULL: a null that got past validation reached save() and answered 500.
  it.each(['name', 'replyText', 'cooldownSeconds', 'enabled'])('rejects %s: null with a 400', async key => {
    await expect(through({ [key]: null })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still accepts an empty body and conditions: null, which clears the conditions', async () => {
    await expect(through({})).resolves.toEqual({});
    await expect(through({ conditions: null })).resolves.toEqual({ conditions: null });
  });
});

// PostgreSQL text and varchar columns cannot store U+0000; a NUL that got past validation failed the
// write with a 500.
describe.each([
  ['CreateAutomationRuleDto', CreateAutomationRuleDto],
  ['UpdateAutomationRuleDto', UpdateAutomationRuleDto],
])('%s NUL characters', (_name, metatype) => {
  const pipe = new ValidationPipe(GLOBAL_VALIDATION_OPTIONS);
  const valid = { name: 'greeting', replyText: 'hi there' };

  it.each(['name', 'replyText'])('rejects a NUL in %s with a 400', async key => {
    await expect(pipe.transform({ ...valid, [key]: 'a\u0000b' }, { type: 'body', metatype })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(pipe.transform(valid, { type: 'body', metatype })).resolves.toEqual(valid);
  });
});
