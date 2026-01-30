import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import * as mongoose from 'mongoose';

export type TransactionDocument = mongoose.HydratedDocument<Transaction>;

@Schema()
export class Transaction {
  @Prop({ type: mongoose.Schema.Types.BigInt, ref: 'User' })
  chatId: number;

  @Prop()
  amount: string;

  @Prop()
  receiver: string;

  @Prop()
  token: string;

  @Prop()
  hash: string;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
