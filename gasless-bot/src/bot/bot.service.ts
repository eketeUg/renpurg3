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

  handleRecievedMessages = async (msg: any) => {
    this.logger.debug(msg);
    try {
      await this.gaslessBot.sendChatAction(msg.chat.id, 'typing');

      const command = msg.text!;

      const sendRegex =
        /^\s*(?:send\s+)?(\d+(?:\.\d+)?)\s+(?:usdc\s+)?([1-9A-HJ-NP-Za-km-z]{32,44})\s*$/i;

      const matchSend = command?.trim().match(sendRegex);

      console.log('matchSend :', matchSend);

      const user = await this.UserModel.findOne({ chatId: msg.chat.id });

      if (matchSend) {
        const amount = matchSend[1];
        const recipientAddress = matchSend[2];

        const senderAddress = user?.svmWalletAddress;
        if (!senderAddress) {
          return await this.gaslessBot.sendMessage(
            msg.chat.id,
            `You don't have any wallet connected`,
          );
        }

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

        const sendPrivateKey = await this.walletService.decryptSVMWallet(
          process.env.DEFAULT_WALLET_PIN!,
          user!.svmWalletDetails,
        );

        console.log('rpc :', process.env.SOLANA_RPC_URL!);

        const signer = Keypair.fromSecretKey(
          bs58.decode(sendPrivateKey.privateKey),
        );

        const stopLoader = await this.sendStickerLoader(msg.chat.id);
        const sendResult = await this.koraService.sendToken(
          user.svmWalletAddress,
          recipientAddress,
          parseFloat(amount),
          signer,
        );

        if (sendResult.signature) {
          await stopLoader();
          return await this.gaslessBot.sendMessage(
            msg.chat.id,
            `✅ Successfully sent ${amount} USDC to <code>${recipientAddress}</code>\n\nTransaction Signature: <a href="${process.env.SOLANA_SCAN_URL}tx/${sendResult.signature}?cluster=devnet">${sendResult.signature}</a>`,
            { parse_mode: 'HTML' },
          );
        } else {
          await stopLoader();
          return await this.gaslessBot.sendMessage(
            msg.chat.id,
            `❌ Failed to send USDC: ${sendResult.errorMessage}`,
          );
        }
      }

      if (command === '/start') {
        let welcome;
        console.log('User   ', user);
        const username = msg.from.username;
        if (!user) {
          const newSVMWallet = await this.walletService.createSVMWallet();
          const [encryptedSVMWalletDetails] = await Promise.all([
            this.walletService.encryptSVMWallet(
              process.env.DEFAULT_WALLET_PIN!,
              newSVMWallet.privateKey,
            ),
          ]);

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

        welcome = await welcomeMessageMarkup(
          username,
          user.svmWalletAddress,
          solBalance.balance.toFixed(2),
          usdcBalance.balance.toFixed(2),
        );
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
      if (command === '/cancel') {
        return await this.gaslessBot.sendMessage(
          msg.chat.id,
          ' ✅All  active sessions closed successfully',
        );
      }
      if (command === '/balance') {
        await this.showBalance(msg.chat.id);
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
          await this.gaslessBot.sendChatAction(chatId, 'typing');
          await this.sendAllFeature(user);
          return;

        case '/walletDetails':
          await this.gaslessBot.sendChatAction(chatId, 'typing');
          await this.sendAllWalletDetails(chatId, user);
          return;

        case '/fundWallet':
          if (user?.svmWalletAddress) {
            let message = 'Wallet Address:\n';

            if (user?.svmWalletAddress) {
              message += `<b><code>${user.svmWalletAddress}</code></b>\n\n`;
            }

            message += 'Send USDC to your address above.';

            return await this.gaslessBot.sendMessage(chatId, message, {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: 'Close ❌',
                      callback_data: JSON.stringify({
                        command: '/close',
                        language: 'english',
                      }),
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
            'You dont have any wallet Address to fund',
          );

        case '/checkBalance':
          return this.showBalance(chatId);

        case '/viewKoraNodeStats':
          return this.viewKoraNode(chatId);

        case '/sendUSDC':
          await this.gaslessBot.sendChatAction(chatId, 'typing');

          return await this.promptSendToken(chatId);

        //   close opened markup and delete session
        case '/closeDelete':
          await this.gaslessBot.sendChatAction(query.message.chat.id, 'typing');
          return await this.gaslessBot.deleteMessage(
            query.message.chat.id,
            query.message.message_id,
          );

        case '/close':
          await this.gaslessBot.sendChatAction(query.message.chat.id, 'typing');
          return await this.gaslessBot.deleteMessage(
            query.message.chat.id,
            query.message.message_id,
          );

        default:
          return await this.gaslessBot.sendMessage(
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
      await this.gaslessBot.sendChatAction(user.chatId, 'typing');
      const allFeatures = await allFeaturesMarkup();
      if (allFeatures) {
        const replyMarkup = {
          inline_keyboard: allFeatures.keyboard,
        };
        await this.gaslessBot.sendMessage(user.chatId, allFeatures.message, {
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        });
      }
    } catch (error) {
      console.log(error);
    }
  };

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
        const replyMarkup = {
          inline_keyboard: allWalletFeatures.keyboard,
        };
        await this.gaslessBot.sendMessage(chatId, allWalletFeatures.message, {
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        });
      }
    } catch (error) {
      console.log(error);
    }
  };

  viewKoraNode = async (chatId: any) => {
    try {
      await this.gaslessBot.sendChatAction(chatId, 'typing');

      const kora_provider_details = await showKoraNodeStatsMarkup();
      if (kora_provider_details) {
        const replyMarkup = {
          inline_keyboard: kora_provider_details.keyboard,
        };
        await this.gaslessBot.sendMessage(
          chatId,
          kora_provider_details.message,
          {
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
          },
        );
      }
      return;
    } catch (error) {
      console.log(error);
    }
  };

  showBalance = async (chatId: string, showMarkUp = true) => {
    try {
      await this.gaslessBot.sendChatAction(chatId, 'typing');
      const user = await this.UserModel.findOne({ chatId: chatId });
      if (!user?.svmWalletAddress) {
        return this.gaslessBot.sendMessage(
          chatId,
          `You don't have any wallet connected`,
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
        const showBalance = await showBalanceMarkup(
          solBalance.balance.toFixed(2),
          usdcBalance.balance.toFixed(2),
        );
        if (showBalance) {
          const replyMarkup = { inline_keyboard: showBalance.keyboard };

          return await this.gaslessBot.sendMessage(
            chatId,
            showBalance.message,
            {
              parse_mode: 'HTML',
              reply_markup: replyMarkup,
            },
          );
        }
      } else {
        return;
      }
    } catch (error) {
      console.log('General error in showBalance:', error);
    }
  };

  promptSendToken = async (chatId: TelegramBot.ChatId) => {
    try {
      await this.gaslessBot.sendChatAction(chatId, 'typing');
      await this.gaslessBot.sendMessage(
        chatId,
        `enter the amount of USDC you want to send and the recipient's wallet address in the format below:\n\n<code>amount recipient_wallet_address</code>\n\nFor example:\n<code>10 RecipientWalletAddressHere</code>`,
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

  sendStickerLoader = async (chatId: TelegramBot.ChatId) => {
    try {
      const animationMsg = await this.gaslessBot.sendAnimation(
        chatId,
        'https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExZnIxOTZ3bWQ5OTJtcTBncXl3Nzl1cm00NGd4NGZqMW84bTE0b3M3byZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9cw/FAgpqNvSeUQSmrOewI/giphy.gif',
      );

      const textMsg = await this.gaslessBot.sendMessage(
        chatId,
        'Sending Token please wait ...',
      );

      // 👇 return cleanup function
      return async () => {
        try {
          await this.gaslessBot.deleteMessage(chatId, animationMsg.message_id);

          await this.gaslessBot.deleteMessage(chatId, textMsg.message_id);
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
