import { Injectable, Logger } from '@nestjs/common';
import { KoraClient } from '@solana/kora';
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  MicroLamports,
  Rpc,
  SolanaRpcApi,
} from '@solana/kit';
import { createRecentSignatureConfirmationPromiseFactory } from '@solana/transaction-confirmation';

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

/**
 * Service for interacting with the Kora protocol.
 * Handles gasless transaction creation and sponsorship via a Kora node.
 */
@Injectable()
export class KoraClientService {
  private readonly logger = new Logger(KoraClientService.name);

  private CONFIG = {
    computeUnitLimit: 200_000,
    computeUnitPrice: 1_000_000n as MicroLamports,
    solanaRpcUrl: process.env.SOLANA_RPC_URL,
    solanaWsUrl: process.env.SOLANA_WS_URL,
    koraRpcUrl: process.env.KORA_RPC_URL,
  };

  private koraClient: KoraClient;
  private rpc: Rpc<SolanaRpcApi>;
  private rpcSubscriptions: any;
  private confirmTransaction: any;
  private kora_signer: any;
  private connection = new Connection(process.env.SOLANA_RPC_URL!, 'confirmed');

  constructor() {
    this.koraClient = new KoraClient({
      rpcUrl: this.CONFIG.koraRpcUrl!,
    });
    this.rpc = createSolanaRpc(this.CONFIG.solanaRpcUrl!);
    this.rpcSubscriptions = createSolanaRpcSubscriptions(
      this.CONFIG.solanaWsUrl!,
    );

    this.confirmTransaction = createRecentSignatureConfirmationPromiseFactory({
      rpc: this.rpc as any,
      rpcSubscriptions: this.rpcSubscriptions,
    });

    this.kora_signer = this.koraClient.getPayerSigner();
  }

  /**
   * Orchestrates a gasless token transfer.
   * 1. Creates a transfer transaction via Kora client.
   * 2. Retrieves a payment instruction for the sponsorship fee.
   * 3. Combines instructions and signs with the user's key.
   * 4. Relays the transaction back to Kora for execution.
   */
  async sendToken(
    sender: string,
    receiverAddress: string,
    amount: number,
    signer: any,
  ): Promise<any> {
    try {
      // Create initial transfer transaction (without sponsorship)
      const transfer = await this.koraClient.transferTransaction({
        amount: amount * 1000000, // USDC (6 decimals)
        token: process.env.USDC_MINT_ADDRESS!,
        source: sender,
        destination: receiverAddress,
      });

      // Get payment instruction to pay for the sponsorship in USDC
      const paymentInstruction = await this.koraClient.getPaymentInstruction({
        transaction: transfer.transaction,
        fee_token: process.env.USDC_MINT_ADDRESS!,
        source_wallet: sender,
      });

      // Convert Kora instruction to web3.js format
      const sponsorIx = this.toWeb3Instruction(
        paymentInstruction.payment_instruction,
      );

      const txBuffer = Buffer.from(transfer.transaction, 'base64');
      const transaction = Transaction.from(txBuffer);

      // Add sponsorship payment instruction to the transaction
      transaction.add(sponsorIx);

      // Sign with the user's private key
      transaction.sign(signer);

      // Send the signed transaction back to Kora for sponsorship and execution
      const result = await this.koraClient.signAndSendTransaction({
        transaction: transaction
          .serialize({ verifySignatures: false })
          .toString('base64'),
      });

      return result;
    } catch (error) {
      this.logger.error('Error in gasless token transfer:', error.message);
      return { signature: null, errorMessage: error.message };
    }
  }

  /**
   * Utility to convert Kora-specific instruction format to standard web3.js TransactionInstruction.
   */
  toWeb3Instruction(koraIx: any): TransactionInstruction {
    return new TransactionInstruction({
      programId: new PublicKey(koraIx.programAddress),
      keys: koraIx.accounts.map((acc: any) => ({
        pubkey: new PublicKey(acc.address),
        isSigner: acc.role === 2, // role 2 corresponds to signer
        isWritable: acc.role !== 0,
      })),
      data: Buffer.from(koraIx.data),
    });
  }
}
