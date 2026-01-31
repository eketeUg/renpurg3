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
  VersionedTransaction,
} from '@solana/web3.js';

// import * as dotenv from 'dotenv';
// dotenv.config();

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
  private connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');

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

  async sendToken(
    sender: any,
    receiverAddress: any,
    amount: number,
    signer: any,
  ): Promise<any> {
    console.log(sender);

    const transfer = await this.koraClient.transferTransaction({
      amount: amount * 1000000, // 1 USDC (6 decimals)
      token: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      source: sender,
      destination: receiverAddress,
    });

    console.log('Transfer Transaction:', transfer.instructions);

    const paymentInstruction = await this.koraClient.getPaymentInstruction({
      transaction: transfer.transaction,
      fee_token: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC Mint Address
      source_wallet: sender,
    });

    console.log(paymentInstruction.payment_amount);

    const sponsorIx = this.toWeb3Instruction(
      paymentInstruction.payment_instruction,
    );
    console.log('Converted Sponsor Instruction:', sponsorIx);

    const txBuffer = Buffer.from(transfer.transaction, 'base64');
    const transaction = Transaction.from(txBuffer);
    console.log(
      'Raw Transaction before adding Payment Instruction:',
      transaction,
    );

    transaction.add(sponsorIx);
    transaction.sign(signer);

    console.log(
      'Raw Transaction with Payment Instruction:',
      transaction.instructions,
    );

    const result = await this.koraClient.signAndSendTransaction({
      transaction: transaction
        .serialize({ verifySignatures: false })
        .toString('base64'),
    });

    console.log('Transaction Result:', result);
    return result;
  }

  toWeb3Instruction(koraIx: any): TransactionInstruction {
    return new TransactionInstruction({
      programId: new PublicKey(koraIx.programAddress),
      keys: koraIx.accounts.map((acc: any) => ({
        pubkey: new PublicKey(acc.address),
        isSigner: acc.role === 2, // role 2 usually means signer
        isWritable: acc.role !== 0, // depends on Kora spec
      })),
      data: Buffer.from(koraIx.data),
    });
  }

  deserializeTransaction(base64Tx: string): Transaction | VersionedTransaction {
    if (!base64Tx || typeof base64Tx !== 'string') {
      throw new Error('Invalid input: base64Tx must be a non-empty string');
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64Tx, 'base64');
    } catch (err) {
      throw new Error(`Failed to decode base64: ${(err as Error).message}`);
    }

    // Try versioned transaction first (v0) — more modern & common with lookup tables
    try {
      return VersionedTransaction.deserialize(buffer);
    } catch (e) {
      // fallback to legacy
      try {
        return Transaction.from(buffer);
      } catch (legacyErr) {
        throw new Error(
          `Deserialization failed for both VersionedTransaction and legacy Transaction.\n` +
            `Versioned error: ${(e as Error).message}\n` +
            `Legacy error:   ${(legacyErr as Error).message}`,
        );
      }
    }
  }
}
