import { Test, TestingModule } from '@nestjs/testing';
import { KoraClientService } from './kora-client.service';

describe('KoraClientService', () => {
  let service: KoraClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [KoraClientService],
    }).compile();

    service = module.get<KoraClientService>(KoraClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
