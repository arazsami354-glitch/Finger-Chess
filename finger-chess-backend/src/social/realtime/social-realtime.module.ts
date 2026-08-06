import { Global, Module } from '@nestjs/common';
import { SocialRealtimeService } from './social-realtime.service';

@Global()
@Module({
  providers: [SocialRealtimeService],
  exports: [SocialRealtimeService],
})
export class SocialRealtimeModule {}
