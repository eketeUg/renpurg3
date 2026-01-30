import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import * as mongoose from 'mongoose';

export type UserDocument = mongoose.HydratedDocument<User>;

@Schema()
export class User {
  @Prop({ unique: true })
  chatId: string;

  @Prop()
  userName: string;

  @Prop()
  svmWalletAddress: string;

  @Prop()
  svmWalletDetails: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
