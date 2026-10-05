import { CreateChannelDto } from './create-channel.dto';

const property = (name: string) =>
  Reflect.getMetadata('swagger/apiModelProperties', CreateChannelDto.prototype, name) as { maxLength?: number };

// The validator caps both fields; the contract has to publish the same caps, or a generated client
// accepts input the server then refuses.
describe('CreateChannelDto contract', () => {
  it.each([
    ['name', 100],
    ['description', 2048],
  ])('publishes the %s length cap the validator enforces', (name, max) => {
    expect(property(name).maxLength).toBe(max);
  });
});
