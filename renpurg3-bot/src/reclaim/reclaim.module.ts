import { Module } from '@nestjs/common';
import { ReclaimService } from './reclaim.service';

@Module({
  providers: [ReclaimService],
  exports: [ReclaimService],
})
export class ReclaimModule {}
