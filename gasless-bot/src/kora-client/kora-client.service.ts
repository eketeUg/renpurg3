import { Injectable } from '@nestjs/common';
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

@Injectable()
export class KoraClientService {
  private CONFIG = {
    computeUnitLimit: 200_000,
    computeUnitPrice: 1_000_000n as MicroLamports,
    solanaRpcUrl: process.env.SOLANA_RPC_URL,
    solanaWsUrl: process.env.SOLANA_WS_URL,
    koraRpcUrl: process.env.KORA_RPC_URL,
  };
  private koraClient: KoraClient;
  private rpc;
  private rpcSubscriptions;
  private confirmTransaction;
  private kora_signer;

  constructor() {
    this.koraClient = new KoraClient({
      rpcUrl: this.CONFIG.koraRpcUrl!,
    });
    this.rpc = createSolanaRpc(this.CONFIG.solanaRpcUrl!);
    this.rpcSubscriptions = createSolanaRpcSubscriptions(
      this.CONFIG.solanaWsUrl,
    );

    this.confirmTransaction = createRecentSignatureConfirmationPromiseFactory({
      rpc: this.rpc,
      rpcSubscriptions: this.rpcSubscriptions,
    });

    this.kora_signer = this.koraClient.getPayerSigner();
  }

  createInstructions = async (sender: KeyPairSigner, receiver: string) => {
    console.log('\n[1/4] Creating instructions');
    const paymentToken = await this.koraClient
      .getConfig()
      .then((config) => config.validation_config.allowed_spl_paid_tokens[0]);

    console.log('  → Payment token:', paymentToken);

    // Create token transfer (will initialize ATA if needed)
    const transferTokens = await this.koraClient.transferTransaction({
      amount: 10_000_000, // 10 USDC (6 decimals)
      token: paymentToken,
      source: sender.address,
      destination: receiver,
    });
    console.log('  ✓ Token transfer instruction created');

    // Create SOL transfer
    const transferSol = await this.koraClient.transferTransaction({
      amount: 10_000_000, // 0.01 SOL (9 decimals)
      token: '11111111111111111111111111111111', // SOL mint address
      source: sender.address,
      destination: receiver,
    });
    console.log('  ✓ SOL transfer instruction created');

    // Add memo instruction
    const memoInstruction = getAddMemoInstruction({
      memo: 'Hello, Kora-gasless bot transfer!',
    });
    console.log('  ✓ Memo instruction created');

    const instructions = [
      ...transferTokens.instructions,
      ...transferSol.instructions,
      memoInstruction,
    ];

    console.log(`  → Total: ${instructions.length} instructions`);
    return { instructions, paymentToken };
  };

  getPaymentInstructions = async (
    instructions: Instruction[],
    sender: KeyPairSigner,
    paymentToken: string,
  ): Promise<{ paymentInstruction: Instruction }> => {
    console.log(
      '\n[2/4] Estimating Kora fee and assembling payment instruction',
    );

    const { signer_address } = await this.koraClient.getPayerSigner();
    const noopSigner = createNoopSigner(address(signer_address));
    const latestBlockhash = await this.koraClient.getBlockhash();

    console.log('  → Fee payer:', signer_address.slice(0, 8) + '...');
    console.log(
      '  → Blockhash:',
      latestBlockhash.blockhash.slice(0, 8) + '...',
    );

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
    console.log('  ✓ Estimate transaction built');

    // Get payment instruction from Kora
    const paymentInstruction = await this.koraClient.getPaymentInstruction({
      transaction: base64EncodedWireTransaction,
      fee_token: paymentToken,
      source_wallet: sender.address,
    });
    console.log('  ✓ Payment instruction received from Kora');

    return { paymentInstruction: paymentInstruction.payment_instruction };
  };

  getFinalTransaction = async (
    paymentInstruction: Instruction,
    sender: KeyPairSigner,
    instructions: Instruction[],
    signer_address: string,
  ): Promise<Base64EncodedWireTransaction> => {
    console.log(
      '\n[3/4] Creating and signing final transaction (with payment)',
    );
    const noopSigner = createNoopSigner(address(signer_address));

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
    console.log('  ✓ Final transaction built with payment');

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
    console.log('  ✓ Transaction signed by user');

    return base64EncodedWireFullTransaction;
  };

  submitTransaction = async (
    rpc: Rpc<SolanaRpcApi>,
    confirmTransaction: ReturnType<
      typeof createRecentSignatureConfirmationPromiseFactory
    >,
    signedTransaction: Base64EncodedWireTransaction,
    signer_address: string,
  ) => {
    console.log(
      '\n[4/4] Signing transaction with Kora and sending to Solana cluster',
    );

    // Get Kora's signature
    const { signed_transaction } = await this.koraClient.signTransaction({
      transaction: signedTransaction,
      signer_key: signer_address,
    });
    console.log('  ✓ Transaction co-signed by Kora');

    // Submit to Solana network
    const signature = await rpc
      .sendTransaction(signed_transaction as Base64EncodedWireTransaction, {
        encoding: 'base64',
      })
      .send();
    console.log('  ✓ Transaction submitted to network');

    console.log('  ⏳ Awaiting confirmation...');
    await confirmTransaction({
      commitment: 'confirmed',
      signature,
      abortSignal: new AbortController().signal,
    });

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SUCCESS: Transaction confirmed on Solana');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\nTransaction signature:');
    console.log(signature);

    return signature;
  };

  sendToken = async (
    sender: KeyPairSigner,
    received: string,
    amount: string,
  ) => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('KORA GASLESS TRANSACTION DEMO');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
      // Step 3: Create demo instructions
      const { instructions, paymentToken } = await this.createInstructions(
        sender,
        received,
      );

      // Step 4: Get payment instruction from Kora
      const { paymentInstruction } = await this.getPaymentInstructions(
        instructions,
        sender,
        paymentToken,
      );

      // Step 5: Create and partially sign final transaction
      const finalSignedTransaction = await this.getFinalTransaction(
        paymentInstruction,
        sender,
        instructions,
        this.kora_signer,
      );

      // Step 6: Get Kora's signature and submit to Solana cluster
      await this.submitTransaction(
        this.rpc,
        this.confirmTransaction,
        finalSignedTransaction,
        this.kora_signer.address,
      );
    } catch (error) {
      console.error(
        '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      );
      console.error('ERROR: Demo failed');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('\nDetails:', error);
      process.exit(1);
    }
  };
}
