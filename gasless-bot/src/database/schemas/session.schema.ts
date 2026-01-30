import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import * as mongoose from 'mongoose';

export type SessionDocument = mongoose.HydratedDocument<Session>;

@Schema()
export class Session {
  @Prop({ type: mongoose.Schema.Types.BigInt, ref: 'User' })
  chatId: number;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  user: mongoose.Types.ObjectId;

  @Prop({ default: false })
  sessionOn: boolean;

  @Prop({ default: false })
  resetWallet: boolean;

  @Prop({ default: false })
  importWalletPromptInput: boolean;

  @Prop({ default: false })
  tokenAmount: boolean;

  @Prop()
  receiver: string;

  @Prop()
  messageId: number;

  @Prop()
  importWalletPromptInputId: number[];

  @Prop()
  userInputId: number[];

  @Prop()
  transactionId: string;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
