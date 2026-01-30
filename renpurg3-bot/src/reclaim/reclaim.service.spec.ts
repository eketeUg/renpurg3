import { Test, TestingModule } from '@nestjs/testing';
import { ReclaimService } from './reclaim.service';

describe('ReclaimService', () => {
  let service: ReclaimService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReclaimService],
    }).compile();

    service = module.get<ReclaimService>(ReclaimService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
