import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module';
import { SessionTakeoverService } from './session-takeover.service';

/**
 * The takeover sweep starts sessions through SessionService. A claim on that path has the lapsed
 * holder's unfinished bulk batches failed through the ownership adoption handler, so nothing here
 * needs MessageModule.
 */
@Module({
  imports: [SessionModule],
  providers: [SessionTakeoverService],
})
export class TakeoverModule {}
