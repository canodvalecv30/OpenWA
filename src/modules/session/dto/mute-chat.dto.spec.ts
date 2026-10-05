import { DECORATORS } from '@nestjs/swagger';
import { MuteChatDto } from './mute-chat.dto';

describe('MuteChatDto published schema', () => {
  // @nestjs/swagger derives nothing from @IsInt/@Min, so the decorator has to state both.
  it('publishes muteUntil as a nullable integer of at least 1', () => {
    expect(Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES, MuteChatDto.prototype, 'muteUntil')).toMatchObject({
      type: 'integer',
      nullable: true,
      minimum: 1,
    });
  });
});
