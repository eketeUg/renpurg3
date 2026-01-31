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

/**
 * Service for managing the RentPurg3 Bot.
 * Provides the interface for node operators to scan for and reclaim rent-locked SOL.
 */
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

  /**
   * Main handler for incoming messages from operators.
   * Supports scanning by wallet address or command.
   */
  handleRecievedMessages = async (msg: any) => {
    try {
      await this.renPurge3Bot.sendChatAction(msg.chat.id, 'typing');

      const walletRegex = /^\s*([1-9A-HJ-NP-Za-km-z]{32,44})\s*$/;
      const match = msg.text?.trim().match(walletRegex);

      const user = await this.UserModel.findOne({ chatId: msg.chat.id });

      // If operator sends a wallet address, trigger a scan for that address
      if (match) {
        const walletAddress = match[1];
        await this.scanProvider(msg.chat.id, walletAddress);
      }

      const command = msg.text!;

      if (command === '/start') {
        const username = msg.from.username;

        if (!user) {
          await this.UserModel.create({
            chatId: msg.chat.id,
            userName: username,
          });
        }

        const welcome = await welcomeMessageMarkup(username);
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

      // Handle /cancel command
      if (command === '/cancel') {
        return await this.renPurge3Bot.sendMessage(
          msg.chat.id,
          '✅ All active scanning sessions closed.',
        );
      }
    } catch (error) {
      this.logger.error('Error handling message:', error);
    }
  };

  /**
   * Logic for handling operator interactions with inline buttons.
   */
  handleButtonCommands = async (query: any) => {
    let command: string;

    const isJSON = (str: string) => {
      try {
        JSON.parse(str);
        return true;
      } catch {
        return false;
      }
    };

    if (isJSON(query.data)) {
      const parsedData = JSON.parse(query.data);
      command = parsedData.command;
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

        case '/close':
        case '/closeDelete':
          await this.renPurge3Bot.sendChatAction(chatId, 'typing');
          return await this.renPurge3Bot.deleteMessage(
            chatId,
            query.message.message_id,
          );

        default:
          return await this.renPurge3Bot.sendMessage(
            chatId,
            `⚠️ Failed to process command. Please try again.`,
          );
      }
    } catch (error) {
      this.logger.error('Error handling button command:', error);
    }
  };

  /**
   * Displays the operator menu.
   */
  sendAllFeature = async (user: UserDocument) => {
    try {
      await this.renPurge3Bot.sendChatAction(user.chatId, 'typing');
      const allFeatures = await allFeaturesMarkup();
      if (allFeatures) {
        const replyMarkup = { inline_keyboard: allFeatures.keyboard };
        await this.renPurge3Bot.sendMessage(user.chatId, allFeatures.message, {
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        });
      }
    } catch (error) {
      this.logger.error('Error sending all features:', error);
    }
  };

  /**
   * Prompts the operator to paste a provider address to scan.
   */
  promptWalletInput = async (chatId: TelegramBot.ChatId) => {
    try {
      await this.renPurge3Bot.sendChatAction(chatId, 'typing');
      await this.renPurge3Bot.sendMessage(
        chatId,
        `🔗 Please paste the <b>Kora Provider Wallet</b> address you wish to scan for reclaimable rent:`,
        {
          parse_mode: 'HTML',
          reply_markup: { force_reply: true },
        },
      );
    } catch (error) {
      this.logger.error('Error prompting for wallet input:', error);
    }
  };

  /**
   * Initiates a scan of the Solana ledger to find accounts sponsored by a specific provider.
   */
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

      await stopLoader();

      if (result.length > 0) {
        const markup = await showKoraNodeStatsMarkup(result);
        if (markup) {
          const replyMarkup = { inline_keyboard: markup.keyboard };
          await this.renPurge3Bot.sendMessage(chatId, markup.message, {
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
          });
        }
      } else {
        await this.renPurge3Bot.sendMessage(
          chatId,
          `✅ No reclaimable ATAs found for the provided wallet. All accounts are either active or purged.`,
          { parse_mode: 'HTML' },
        );
      }
    } catch (error) {
      this.logger.error('Error scanning provider:', error);
    }
  };

  /**
   * Displays a loading animation during the scanning process.
   */
  sendStickerLoader = async (chatId: TelegramBot.ChatId) => {
    try {
      const animationMsg = await this.renPurge3Bot.sendAnimation(
        chatId,
        'https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExZnIxOTZ3bWQ5OTJtcTBncXl3Nzl1cm00NGd4NGZqMW84bTE0b3M3byZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9cw/FAgpqNvSeUQSmrOewI/giphy.gif',
      );

      const textMsg = await this.renPurge3Bot.sendMessage(
        chatId,
        '🔍 Scanning Solana ledger for sponsored accounts...',
      );

      return async () => {
        try {
          await this.renPurge3Bot.deleteMessage(
            chatId,
            animationMsg.message_id,
          );
          await this.renPurge3Bot.deleteMessage(chatId, textMsg.message_id);
        } catch {
          // Ignore deletion errors
        }
      };
    } catch (error) {
      this.logger.error('Error sending sticker loader:', error);
      return async () => {};
    }
  };
}
