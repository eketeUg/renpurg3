import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as TelegramBot from 'node-telegram-bot-api';
import { User, UserDocument } from 'src/database/schemas/user.schema';
import { WalletService } from 'src/wallet/wallet.service';
import {
  allFeaturesMarkup,
  showKoraNodeStatsMarkup,
  welcomeMessageMarkup,
} from './markups';

import { ReclaimService } from 'src/reclaim/reclaim.service';

const token = process.env.TELEGRAM_TOKEN;

@Injectable()
export class BotService {
  private readonly renPurge3Bot: TelegramBot;
  private logger = new Logger(BotService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly reclaimService: ReclaimService,
    @InjectModel(User.name) private readonly UserModel: Model<User>,
  ) {
    this.renPurge3Bot = new TelegramBot(token, { polling: true });
    this.renPurge3Bot.on('message', this.handleRecievedMessages);
    this.renPurge3Bot.on('callback_query', this.handleButtonCommands);
  }

  handleRecievedMessages = async (msg: any) => {
    this.logger.debug(msg);
    try {
      await this.renPurge3Bot.sendChatAction(msg.chat.id, 'typing');

      const walletRegex = /^\s*([1-9A-HJ-NP-Za-km-z]{32,44})\s*$/;

      const match = msg.text?.trim().match(walletRegex);

      const user = await this.UserModel.findOne({ chatId: msg.chat.id });

      if (match) {
        const walletAddress = match[1];
        console.log('Wallet:', walletAddress);

        await this.scanProvider(msg.chat.id, walletAddress);
      }

      const command = msg.text!;
      console.log('Command :', command);

      if (command === '/start') {
        let welcome;
        console.log('User   ', user);
        const username = msg.from.username;
        if (!user) {
          await this.UserModel.create({
            chatId: msg.chat.id,
            userName: username,
          });

          welcome = await welcomeMessageMarkup(username);
        }

        welcome = await welcomeMessageMarkup(username);
        if (welcome) {
          const replyMarkup = { inline_keyboard: welcome.keyboard };
          await this.renPurge3Bot.sendMessage(msg.chat.id, welcome.message, {
            reply_markup: replyMarkup,
            parse_mode: 'HTML',
          });
        }
        return;
      }

      // Handle /menu command
      if (command === '/menu') {
        const allFeatures = await allFeaturesMarkup();
        if (allFeatures) {
          const replyMarkup = { inline_keyboard: allFeatures.keyboard };
          await this.renPurge3Bot.sendMessage(
            msg.chat.id,
            allFeatures.message,
            {
              parse_mode: 'HTML',
              reply_markup: replyMarkup,
            },
          );
        }
      }
      if (command === '/cancel') {
        return await this.renPurge3Bot.sendMessage(
          msg.chat.id,
          ' ✅All  active sessions closed successfully',
        );
      }
    } catch (error) {
      console.error(error);
    }
  };

  handleButtonCommands = async (query: any) => {
    this.logger.debug(query);
    let command: string;

    function isJSON(str) {
      try {
        JSON.parse(str);
        return true;
      } catch (e) {
        console.log(e);
        return false;
      }
    }

    if (isJSON(query.data)) {
      const parsedData = JSON.parse(query.data);

      if (parsedData.command) {
        command = parsedData.command;
      }
    } else {
      command = query.data;
    }

    const chatId = query.message.chat.id;

    try {
      const user = await this.UserModel.findOne({ chatId: chatId });
      switch (command) {
        case '/menu':
          await this.renPurge3Bot.sendChatAction(chatId, 'typing');
          await this.sendAllFeature(user);
          return;

        case '/scanDefault':
          await this.renPurge3Bot.sendChatAction(chatId, 'typing');
          await this.scanProvider(chatId);
          return;

        case '/scanImported':
          return this.promptWalletInput(chatId);

        //   close opened markup and delete session
        case '/closeDelete':
          await this.renPurge3Bot.sendChatAction(
            query.message.chat.id,
            'typing',
          );
          return await this.renPurge3Bot.deleteMessage(
            query.message.chat.id,
            query.message.message_id,
          );

        case '/close':
          await this.renPurge3Bot.sendChatAction(
            query.message.chat.id,
            'typing',
          );
          return await this.renPurge3Bot.deleteMessage(
            query.message.chat.id,
            query.message.message_id,
          );

        default:
          return await this.renPurge3Bot.sendMessage(
            query.message.chat.id,
            `Processing command failed, please try again`,
          );
      }
    } catch (error) {
      console.log(error);
    }
  };

  sendAllFeature = async (user: UserDocument) => {
    try {
      await this.renPurge3Bot.sendChatAction(user.chatId, 'typing');
      const allFeatures = await allFeaturesMarkup();
      if (allFeatures) {
        const replyMarkup = {
          inline_keyboard: allFeatures.keyboard,
        };
        await this.renPurge3Bot.sendMessage(user.chatId, allFeatures.message, {
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        });
      }
    } catch (error) {
      console.log(error);
    }
  };

  promptWalletInput = async (chatId: TelegramBot.ChatId) => {
    try {
      await this.renPurge3Bot.sendChatAction(chatId, 'typing');
      await this.renPurge3Bot.sendMessage(
        chatId,
        `enter the provider wallet you want to scan`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            force_reply: true,
          },
        },
      );
    } catch (error) {
      console.log(error);
    }
  };

  scanProvider = async (
    chatId: TelegramBot.ChatId,
    providerWallet?: string,
  ) => {
    try {
      await this.renPurge3Bot.sendChatAction(chatId, 'typing');
      const stopLoader = await this.sendStickerLoader(chatId);
      const result = await this.reclaimService.scanProviderWallet(
        providerWallet ? providerWallet : process.env.KORA_PROVIDER_PUBKEY,
      );

      if (result.length > 0) {
        const markup = await showKoraNodeStatsMarkup(result);
        if (markup) {
          await stopLoader();
          const replyMarkup = {
            inline_keyboard: markup.keyboard,
          };
          await this.renPurge3Bot.sendMessage(chatId, markup.message, {
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
          });
        }

        return;
      } else {
        await stopLoader();
        await this.renPurge3Bot.sendMessage(
          chatId,
          `No reclaimable ATAs found for the provided wallet.`,
          {
            parse_mode: 'HTML',
          },
        );
      }
      return;
    } catch (error) {
      console.log(error);
    }
  };

  sendStickerLoader = async (chatId: TelegramBot.ChatId) => {
    try {
      const animationMsg = await this.renPurge3Bot.sendAnimation(
        chatId,
        'https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExZnIxOTZ3bWQ5OTJtcTBncXl3Nzl1cm00NGd4NGZqMW84bTE0b3M3byZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9cw/FAgpqNvSeUQSmrOewI/giphy.gif',
      );

      const textMsg = await this.renPurge3Bot.sendMessage(
        chatId,
        '🔍 Scanning in progress, please wait...',
      );

      // 👇 return cleanup function
      return async () => {
        try {
          await this.renPurge3Bot.deleteMessage(
            chatId,
            animationMsg.message_id,
          );

          await this.renPurge3Bot.deleteMessage(chatId, textMsg.message_id);
        } catch (err) {
          console.log('Failed to cleanup loader:', err.message);
        }
      };
    } catch (error) {
      console.log(error);

      // fallback empty cleanup
      return async () => {};
    }
  };
}
