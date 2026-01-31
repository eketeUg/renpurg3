import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as TelegramBot from 'node-telegram-bot-api';
import { User, UserDocument } from 'src/database/schemas/user.schema';
import { WalletService } from 'src/wallet/wallet.service';
import {
  allFeaturesMarkup,
  showBalanceMarkup,
  showKoraNodeStatsMarkup,
  walletDetailsMarkup,
  welcomeMessageMarkup,
} from './markups';

import bs58 from 'bs58';
import { KoraClientService } from 'src/kora-client/kora-client.service';
import { Keypair } from '@solana/web3.js';

const token = process.env.TELEGRAM_TOKEN;

/**
 * Service responsible for managing the Gasless Transfer Telegram Bot.
 * Handles user messages, button interactions, and orchestrates transaction execution via Kora.
 */
@Injectable()
export class BotService {
  private readonly gaslessBot: TelegramBot;
  private logger = new Logger(BotService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly koraService: KoraClientService,
    @InjectModel(User.name) private readonly UserModel: Model<User>,
  ) {
    this.gaslessBot = new TelegramBot(token, { polling: true });
    this.gaslessBot.on('message', this.handleRecievedMessages);
    this.gaslessBot.on('callback_query', this.handleButtonCommands);
  }

  /**
   * Primary handler for incoming text messages.
   * Parses commands and executes corresponding logic for sending tokens or displaying menus.
   */
  handleRecievedMessages = async (msg: any) => {
    try {
      await this.gaslessBot.sendChatAction(msg.chat.id, 'typing');

      const command = msg.text!;

      // Regex to parse "send <amount> <address>" or simply "<amount> <address>"
      const sendRegex =
        /^\s*(?:send\s+)?(\d+(?:\.\d+)?)\s+(?:usdc\s+)?([1-9A-HJ-NP-Za-km-z]{32,44})\s*$/i;

      const matchSend = command?.trim().match(sendRegex);
      const user = await this.UserModel.findOne({ chatId: msg.chat.id });

      if (matchSend) {
        const amount = matchSend[1];
        const recipientAddress = matchSend[2];

        const senderAddress = user?.svmWalletAddress;
        if (!senderAddress) {
          return await this.gaslessBot.sendMessage(
            msg.chat.id,
            `❌ You don't have a wallet connected. Use /start to create one.`,
          );
        }

        // Check USDC balance before attempting gasless transfer
        const usdcBalance = await this.walletService.getUSDCBalance(
          senderAddress,
          process.env.SOLANA_RPC_URL!,
        );

        if (usdcBalance.balance < parseFloat(amount)) {
          return await this.gaslessBot.sendMessage(
            msg.chat.id,
            `❌ Insufficient USDC balance. Your current balance is ${usdcBalance.balance.toFixed(
              2,
            )} USDC.`,
          );
        }

        // Decrypt wallet to get private key for signing
        const sendPrivateKey = await this.walletService.decryptSVMWallet(
          process.env.DEFAULT_WALLET_PIN!,
          user!.svmWalletDetails,
        );

        const signer = Keypair.fromSecretKey(
          bs58.decode(sendPrivateKey.privateKey),
        );

        const stopLoader = await this.sendStickerLoader(msg.chat.id);

        // Execute gasless transfer via Kora Service
        const sendResult = await this.koraService.sendToken(
          user.svmWalletAddress,
          recipientAddress,
          parseFloat(amount),
          signer,
        );

        await stopLoader();

        if (sendResult.signature) {
          return await this.gaslessBot.sendMessage(
            msg.chat.id,
            `✅ Successfully sent ${amount} USDC to <code>${recipientAddress}</code>\n\nTransaction Signature: <a href="${process.env.SOLANA_SCAN_URL}tx/${sendResult.signature}?cluster=devnet">${sendResult.signature}</a>`,
            { parse_mode: 'HTML' },
          );
        } else {
          return await this.gaslessBot.sendMessage(
            msg.chat.id,
            `❌ Failed to send USDC: ${sendResult.errorMessage || 'Unknown error'}`,
          );
        }
      }

      // Handle /start command
      if (command === '/start') {
        let welcome;
        const username = msg.from.username;

        if (!user) {
          // Create new wallet for new user
          const newSVMWallet = await this.walletService.createSVMWallet();
          const encryptedSVMWalletDetails =
            await this.walletService.encryptSVMWallet(
              process.env.DEFAULT_WALLET_PIN!,
              newSVMWallet.privateKey,
            );

          await this.UserModel.create({
            chatId: msg.chat.id,
            userName: username,
            svmWalletDetails: encryptedSVMWalletDetails.json,
            svmWalletAddress: newSVMWallet.address,
          });

          const [solBalance, usdcBalance] = await Promise.all([
            this.walletService.getSolBalance(
              newSVMWallet.address,
              process.env.SOLANA_RPC_URL!,
            ),
            this.walletService.getUSDCBalance(
              newSVMWallet.address,
              process.env.SOLANA_RPC_URL!,
            ),
          ]);

          welcome = await welcomeMessageMarkup(
            username,
            newSVMWallet.address,
            solBalance.balance.toFixed(2),
            usdcBalance.balance.toFixed(2),
          );
        } else {
          const [solBalance, usdcBalance] = await Promise.all([
            this.walletService.getSolBalance(
              user.svmWalletAddress,
              process.env.SOLANA_RPC_URL!,
            ),
            this.walletService.getUSDCBalance(
              user.svmWalletAddress,
              process.env.SOLANA_RPC_URL!,
            ),
          ]);

          welcome = await welcomeMessageMarkup(
            username,
            user.svmWalletAddress,
            solBalance.balance.toFixed(2),
            usdcBalance.balance.toFixed(2),
          );
        }

        if (welcome) {
          const replyMarkup = { inline_keyboard: welcome.keyboard };
          await this.gaslessBot.sendMessage(msg.chat.id, welcome.message, {
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
          await this.gaslessBot.sendMessage(msg.chat.id, allFeatures.message, {
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
          });
        }
      }

      // Handle /cancel command
      if (command === '/cancel') {
        return await this.gaslessBot.sendMessage(
          msg.chat.id,
          '✅ All active sessions closed successfully.',
        );
      }

      // Handle /balance command
      if (command === '/balance') {
        await this.showBalance(msg.chat.id);
      }
    } catch (error) {
      this.logger.error('Error handling message:', error);
    }
  };

  /**
   * Logic for handling inline button clicks.
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
          await this.gaslessBot.sendChatAction(chatId, 'typing');
          await this.sendAllFeature(user);
          return;

        case '/walletDetails':
          await this.gaslessBot.sendChatAction(chatId, 'typing');
          await this.sendAllWalletDetails(chatId, user);
          return;

        case '/fundWallet':
          if (user?.svmWalletAddress) {
            let message = '<b>Deposit Address:</b>\n';
            message += `<code>${user.svmWalletAddress}</code>\n\n`;
            message +=
              'Send USDC to your address above to start making gasless transfers.';

            return await this.gaslessBot.sendMessage(chatId, message, {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: 'Close ❌',
                      callback_data: JSON.stringify({ command: '/close' }),
                    },
                  ],
                  [
                    {
                      text: 'Circle USDC Faucet 💵',
                      url: `https://faucet.circle.com/`,
                    },
                  ],
                ],
              },
            });
          }
          return await this.gaslessBot.sendMessage(
            chatId,
            '❌ No wallet found. Please use /start to create one.',
          );

        case '/checkBalance':
          return this.showBalance(chatId);

        case '/viewKoraNodeStats':
          return this.viewKoraNode(chatId);

        case '/sendUSDC':
          await this.gaslessBot.sendChatAction(chatId, 'typing');
          return await this.promptSendToken(chatId);

        case '/close':
        case '/closeDelete':
          await this.gaslessBot.sendChatAction(chatId, 'typing');
          return await this.gaslessBot.deleteMessage(
            chatId,
            query.message.message_id,
          );

        default:
          return await this.gaslessBot.sendMessage(
            chatId,
            `⚠️ Unrecognized command. Please try using the menu.`,
          );
      }
    } catch (error) {
      this.logger.error('Error handling button command:', error);
    }
  };

  /**
   * Sends the main features menu to the user.
   */
  sendAllFeature = async (user: UserDocument) => {
    try {
      await this.gaslessBot.sendChatAction(user.chatId, 'typing');
      const allFeatures = await allFeaturesMarkup();
      if (allFeatures) {
        const replyMarkup = { inline_keyboard: allFeatures.keyboard };
        await this.gaslessBot.sendMessage(user.chatId, allFeatures.message, {
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        });
      }
    } catch (error) {
      this.logger.error('Error sending all features:', error);
    }
  };

  /**
   * Displays detailed wallet information including balances.
   */
  sendAllWalletDetails = async (chatId: any, user: UserDocument) => {
    try {
      await this.gaslessBot.sendChatAction(chatId, 'typing');

      const [solBalance, usdcBalance] = await Promise.all([
        this.walletService.getSolBalance(
          user.svmWalletAddress,
          process.env.SOLANA_RPC_URL!,
        ),
        this.walletService.getUSDCBalance(
          user.svmWalletAddress,
          process.env.SOLANA_RPC_URL!,
        ),
      ]);

      const allWalletFeatures = await walletDetailsMarkup(
        user.svmWalletAddress,
        solBalance.balance.toFixed(2),
        usdcBalance.balance.toFixed(2),
      );

      if (allWalletFeatures) {
        const replyMarkup = { inline_keyboard: allWalletFeatures.keyboard };
        await this.gaslessBot.sendMessage(chatId, allWalletFeatures.message, {
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        });
      }
    } catch (error) {
      this.logger.error('Error sending wallet details:', error);
    }
  };

  /**
   * Shows stats related to the Kora node providing sponsorship.
   */
  viewKoraNode = async (chatId: any) => {
    try {
      await this.gaslessBot.sendChatAction(chatId, 'typing');
      const kora_provider_details = await showKoraNodeStatsMarkup();

      if (kora_provider_details) {
        const replyMarkup = { inline_keyboard: kora_provider_details.keyboard };
        await this.gaslessBot.sendMessage(
          chatId,
          kora_provider_details.message,
          {
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
          },
        );
      }
    } catch (error) {
      this.logger.error('Error viewing Kora stats:', error);
    }
  };

  /**
   * Displays the current SOL and USDC balance.
   */
  showBalance = async (chatId: string, showMarkUp = true) => {
    try {
      await this.gaslessBot.sendChatAction(chatId, 'typing');
      const user = await this.UserModel.findOne({ chatId: chatId });

      if (!user?.svmWalletAddress) {
        return this.gaslessBot.sendMessage(
          chatId,
          `❌ No wallet connected. Use /start to create one.`,
        );
      }

      const [solBalance, usdcBalance] = await Promise.all([
        this.walletService.getSolBalance(
          user.svmWalletAddress,
          process.env.SOLANA_RPC_URL!,
        ),
        this.walletService.getUSDCBalance(
          user.svmWalletAddress,
          process.env.SOLANA_RPC_URL!,
        ),
      ]);

      if (showMarkUp) {
        const balanceMarkup = await showBalanceMarkup(
          solBalance.balance.toFixed(2),
          usdcBalance.balance.toFixed(2),
        );

        if (balanceMarkup) {
          const replyMarkup = { inline_keyboard: balanceMarkup.keyboard };
          return await this.gaslessBot.sendMessage(
            chatId,
            balanceMarkup.message,
            {
              reply_markup: replyMarkup,
              parse_mode: 'HTML',
            },
          );
        }
      }
    } catch (error) {
      this.logger.error('Error showing balance:', error);
    }
  };

  /**
   * Prompts the user to provide details for a token transfer.
   */
  promptSendToken = async (chatId: TelegramBot.ChatId) => {
    try {
      await this.gaslessBot.sendChatAction(chatId, 'typing');
      await this.gaslessBot.sendMessage(
        chatId,
        `⚠️ To send USDC, please reply to this message or type in the following format:\n\n<code>amount recipient_address</code>\n\n<b>Example:</b>\n<code>5 D6sFb1qwoLyZN2P2a4YVHTXBsQzc5miDkcqUCg6oeYeo</code>`,
        {
          parse_mode: 'HTML',
          reply_markup: { force_reply: true },
        },
      );
    } catch (error) {
      this.logger.error('Error prompting for token send:', error);
    }
  };

  /**
   * Sends a loading animation while a transaction is being processed.
   * Returns a function to stop the animation and delete the message.
   */
  sendStickerLoader = async (chatId: TelegramBot.ChatId) => {
    try {
      const animationMsg = await this.gaslessBot.sendAnimation(
        chatId,
        'https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExZnIxOTZ3bWQ5OTJtcTBncXl3Nzl1cm00NGd4NGZqMW84bTE0b3M3byZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9cw/FAgpqNvSeUQSmrOewI/giphy.gif',
      );

      const textMsg = await this.gaslessBot.sendMessage(
        chatId,
        '⏳ Processing gasless transaction, please wait...',
      );

      return async () => {
        try {
          await this.gaslessBot.deleteMessage(chatId, animationMsg.message_id);
          await this.gaslessBot.deleteMessage(chatId, textMsg.message_id);
        } catch {
          // Ignore deletion errors (e.g. if message was already deleted)
        }
      };
    } catch (error) {
      this.logger.error('Error sending sticker loader:', error);
      return async () => {};
    }
  };
}
