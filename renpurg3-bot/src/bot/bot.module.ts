import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from 'src/database/schemas/user.schema';

import { WalletModule } from 'src/wallet/wallet.module';
import { ReclaimModule } from 'src/reclaim/reclaim.module';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    WalletModule,
    ReclaimModule,
  ],
  providers: [BotService],
})
export class BotModule {}
