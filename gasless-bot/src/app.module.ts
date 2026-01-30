import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BotModule } from './bot/bot.module';
import { DatabaseModule } from './database/database.module';
import { WalletModule } from './wallet/wallet.module';
import { KoraClientModule } from './kora-client/kora-client.module';

@Module({
  imports: [BotModule, DatabaseModule, WalletModule, KoraClientModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
