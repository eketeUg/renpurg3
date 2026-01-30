import { Injectable, Logger } from '@nestjs/common';
import { KoraClient } from '@solana/kora';
import {
  address,
  appendTransactionMessageInstructions,
  Base64EncodedWireTransaction,
  Blockhash,
  createNoopSigner,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  Instruction,
  KeyPairSigner,
  MicroLamports,
  partiallySignTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  Rpc,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  SolanaRpcApi,
} from '@solana/kit';
import { createRecentSignatureConfirmationPromiseFactory } from '@solana/transaction-confirmation';
import { getAddMemoInstruction } from '@solana-program/memo';
import {
  updateOrAppendSetComputeUnitLimitInstruction,
  updateOrAppendSetComputeUnitPriceInstruction,
} from '@solana-program/compute-budget';
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

  private async createTransferInstructions(
    sender: KeyPairSigner,
    receiver: string,
    amount: number,
  ) {
    this.logger.log('[1/4] Creating instructions');

    // Get authorized payment token configuration
    const paymentToken = await this.koraClient
      .getConfig()
      .then((config) => config.validation_config.allowed_spl_paid_tokens[1]);

    this.logger.debug(`Payment token: ${paymentToken}`);

    // Create token transfer (will initialize ATA if needed)
    // Assuming USDC (6 decimals) for the calculation. verify decimals if shifting to other tokens.
    const amountInSmallestUnit = Math.floor(amount * 1_000_000);

    const transferTokens = await this.koraClient.transferTransaction({
      amount: amountInSmallestUnit,
      token: paymentToken,
      source: sender.address,
      destination: receiver,
    });

    // Add memo instruction
    const memoInstruction = getAddMemoInstruction({
      memo: 'Sent via Kora Gasless Bot',
    });

    const instructions = [...transferTokens.instructions, memoInstruction];

    return { instructions, paymentToken };
  }

  private async getPaymentInstructions(
    instructions: Instruction[],
    sender: KeyPairSigner,
    paymentToken: string,
  ): Promise<{ paymentInstruction: Instruction }> {
    this.logger.log(
      '[2/4] Estimating Kora fee and assembling payment instruction',
    );

    const { signer_address } = await this.koraClient.getPayerSigner();
    const noopSigner = createNoopSigner(address(signer_address));
    const latestBlockhash = await this.koraClient.getBlockhash();

    // Create estimate transaction to get payment instruction
    const estimateTransaction = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(noopSigner, tx),
      (tx) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: latestBlockhash.blockhash as Blockhash,
            lastValidBlockHeight: 0n,
          },
          tx,
        ),
      (tx) => appendTransactionMessageInstructions(instructions, tx),
      (tx) =>
        updateOrAppendSetComputeUnitPriceInstruction(
          this.CONFIG.computeUnitPrice,
          tx,
        ),
      (tx) =>
        updateOrAppendSetComputeUnitLimitInstruction(
          this.CONFIG.computeUnitLimit,
          tx,
        ),
    );

    const signedEstimateTransaction =
      await partiallySignTransactionMessageWithSigners(estimateTransaction);
    const base64EncodedWireTransaction = getBase64EncodedWireTransaction(
      signedEstimateTransaction,
    );

    // Get payment instruction from Kora
    const paymentInstruction = await this.koraClient.getPaymentInstruction({
      transaction: base64EncodedWireTransaction,
      fee_token: paymentToken,
      source_wallet: sender.address,
    });

    return { paymentInstruction: paymentInstruction.payment_instruction };
  }

  private async getFinalTransaction(
    paymentInstruction: Instruction,
    sender: KeyPairSigner,
    instructions: Instruction[],
    signer_address: string,
  ): Promise<Base64EncodedWireTransaction> {
    this.logger.log(
      '[3/4] Creating and signing final transaction (with payment)',
    );
    console.log('signer_address', signer_address);
    const noopSigner = createNoopSigner(address(signer_address));
    console.log('noopSinger', noopSigner);

    // Build final transaction with payment instruction
    const newBlockhash = await this.koraClient.getBlockhash();
    const fullTransaction = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(noopSigner, tx),
      (tx) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: newBlockhash.blockhash as Blockhash,
            lastValidBlockHeight: 0n,
          },
          tx,
        ),
      (tx) =>
        appendTransactionMessageInstructions(
          [...instructions, paymentInstruction],
          tx,
        ),
      (tx) =>
        updateOrAppendSetComputeUnitPriceInstruction(
          this.CONFIG.computeUnitPrice,
          tx,
        ),
      (tx) =>
        updateOrAppendSetComputeUnitLimitInstruction(
          this.CONFIG.computeUnitLimit,
          tx,
        ),
    );

    // Sign with user keypair
    const signedFullTransaction =
      await partiallySignTransactionMessageWithSigners(fullTransaction);
    const userSignedTransaction = await partiallySignTransaction(
      [sender.keyPair],
      signedFullTransaction,
    );
    const base64EncodedWireFullTransaction = getBase64EncodedWireTransaction(
      userSignedTransaction,
    );

    return base64EncodedWireFullTransaction;
  }

  private async submitTransaction(
    rpc: Rpc<SolanaRpcApi>,
    confirmTransaction: any,
    signedTransaction: Base64EncodedWireTransaction,
    signer_address: string,
  ) {
    this.logger.log(
      '[4/4] Signing transaction with Kora and sending to Solana cluster',
    );

    // Get Kora's signature
    const { signed_transaction } = await this.koraClient.signTransaction({
      transaction: signedTransaction,
      signer_key: signer_address,
    });

    // Submit to Solana network
    const signature = await rpc
      .sendTransaction(signed_transaction as Base64EncodedWireTransaction, {
        encoding: 'base64',
      })
      .send();

    this.logger.log(`Transaction submitted: ${signature}`);
    this.logger.log('Awaiting confirmation...');

    await confirmTransaction({
      commitment: 'confirmed',
      signature,
      abortSignal: new AbortController().signal,
    });

    this.logger.log('Transaction confirmed successfully');
    return signature;
  }

  public sendToken = async (
    sender: KeyPairSigner,
    recipient: string,
    amount: number,
  ) => {
    try {
      const koraSigner = await this.koraClient.getPayerSigner();
      // Step 1: Create instructions
      const { instructions, paymentToken } =
        await this.createTransferInstructions(sender, recipient, amount);

      // Step 2: Get payment instruction from Kora
      const { paymentInstruction } = await this.getPaymentInstructions(
        instructions,
        sender,
        paymentToken,
      );

      // Step 3: Create and partially sign final transaction
      const finalSignedTransaction = await this.getFinalTransaction(
        paymentInstruction,
        sender,
        instructions,
        koraSigner.signer_address,
      );

      // Step 4: Get Kora's signature and submit to Solana cluster
      const transactionSignature = await this.submitTransaction(
        this.rpc,
        this.confirmTransaction,
        finalSignedTransaction,
        koraSigner.signer_address,
      );

      return {
        success: true,
        transactionSignature,
      };
    } catch (error) {
      console.log(error);
      this.logger.error('Gasless transfer failed', error);
      return {
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };
}
