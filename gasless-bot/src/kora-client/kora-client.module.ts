import { Module } from '@nestjs/common';
import { KoraClientService } from './kora-client.service';

@Module({
  providers: [KoraClientService],
  exports: [KoraClientService],
})
export class KoraClientModule {}
