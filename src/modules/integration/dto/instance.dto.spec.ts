import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { DECORATORS } from '@nestjs/swagger';
import { CreateInstanceDto, UpdateInstanceDto } from './instance.dto';
import { GLOBAL_VALIDATION_OPTIONS } from '../../../config/app-validation';

describe('UpdateInstanceDto', () => {
  const pipe = new ValidationPipe(GLOBAL_VALIDATION_OPTIONS);
  const through = (value: object): Promise<unknown> =>
    pipe.transform(value, { type: 'body', metatype: UpdateInstanceDto });

  // Omitting sessionScope leaves it unchanged, so null is the only way to return a bound instance to
  // all sessions. It must reach the service as null, not as a string.
  it('accepts sessionScope null, which resets the instance to all sessions', async () => {
    await expect(through({ sessionScope: null })).resolves.toEqual({ sessionScope: null });
  });

  // plugin_instances.enabled is NOT NULL: a null that got past validation reached save() and answered 500.
  it('rejects enabled: null with a 400', async () => {
    await expect(through({ enabled: null })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still rejects an empty sessionScope', async () => {
    await expect(through({ sessionScope: '' })).rejects.toBeInstanceOf(BadRequestException);
  });

  // Generated clients read the published schema, so it has to say null is allowed and what it means.
  it('publishes sessionScope as a nullable string that null resets to all sessions', () => {
    const property = Reflect.getMetadata(
      DECORATORS.API_MODEL_PROPERTIES,
      UpdateInstanceDto.prototype,
      'sessionScope',
    ) as { nullable?: boolean; type?: unknown; description?: string } | undefined;
    expect(property?.nullable).toBe(true);
    expect(property?.type).toBe(String);
    expect(property?.description).toMatch(/null/);
  });
});

type PublishedProperty = { description?: string; pattern?: string; minLength?: number; maxLength?: number };
const published = (dto: object, key: string): PublishedProperty | undefined =>
  Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES, dto, key) as PublishedProperty | undefined;

describe('CreateInstanceDto published schema', () => {
  // @nestjs/swagger does not derive bounds from the validators, so each one is declared explicitly.
  it('publishes the bounds the validators enforce', () => {
    const proto = CreateInstanceDto.prototype;
    expect(published(proto, 'instanceId')?.pattern).toBe('^[a-zA-Z0-9_-]{1,64}$');
    expect(published(proto, 'sessionScope')).toMatchObject({ minLength: 1, maxLength: 256 });
    expect(published(proto, 'verifyToken')?.maxLength).toBe(512);
    expect(published(proto, 'secret')).toMatchObject({ minLength: 16, maxLength: 512 });
    expect(published(UpdateInstanceDto.prototype, 'sessionScope')).toMatchObject({ minLength: 1, maxLength: 256 });
  });

  it('describes the secret mask the API actually returns', () => {
    expect(published(CreateInstanceDto.prototype, 'secret')?.description).toContain("Masked ('***')");
  });
});
