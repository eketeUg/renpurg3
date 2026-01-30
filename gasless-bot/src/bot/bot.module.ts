import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from 'src/database/schemas/user.schema';

import { WalletModule } from 'src/wallet/wallet.module';
import { KoraClientModule } from 'src/kora-client/kora-client.module';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    WalletModule,
    KoraClientModule,
  ],
  providers: [BotService],
})
export class BotModule {}
