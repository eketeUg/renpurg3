import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ReclaimModule } from './reclaim/reclaim.module';
import { BotModule } from './bot/bot.module';
import { DatabaseModule } from './database/database.module';

import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [ReclaimModule, BotModule, DatabaseModule, WalletModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
