import { Module } from '@nestjs/common';
import { ReclaimService } from './reclaim.service';

@Module({
  providers: [ReclaimService]
})
export class ReclaimModule {}
