import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import {
  Keypair,
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';
import {
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

dotenv.config();

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Service for managing Solana and SPL-token wallets.
 * Handles wallet creation, encryption/decryption of private keys, and balance fetching.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  /**
   * Generates a 256-bit hash of a password to be used as an encryption key.
   */
  private generateKey(password: string): Buffer {
    return createHash('sha256').update(password).digest();
  }

  /**
   * Creates a new Solana wallet (Keypair) and returns its address and private key.
   */
  createSVMWallet = (): Record<string, any> => {
    const keypair = Keypair.generate();
    const privateKey = keypair.secretKey;
    const publicKey = keypair.publicKey;

    return {
      address: publicKey.toBase58(),
      privateKey: bs58.encode(privateKey),
    };
  };

  /**
   * Derives a Solana public address from a base58-encoded private key.
   */
  getSVMAddressFromPrivateKey = (
    privateKey: string,
  ): Record<string, string> => {
    try {
      const privateKeyBytes = bs58.decode(privateKey);
      const wallet = Keypair.fromSecretKey(privateKeyBytes);
      return {
        address: wallet.publicKey.toBase58(),
        privateKey: bs58.encode(wallet.secretKey),
      };
    } catch (error) {
      throw new Error(`Invalid private key format: ${error.message}`);
    }
  };

  /**
   * Encrypts a private key using AES-256-CBC with a user-provided PIN.
   */
  encryptSVMWallet = async (
    password: string,
    privateKey: string,
  ): Promise<Record<string, string>> => {
    const key = this.generateKey(password);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const encryptedWallet = iv.toString('hex') + ':' + encrypted;
    return { json: encryptedWallet };
  };

  /**
   * Decrypts an encrypted wallet string using the provided PIN.
   */
  decryptSVMWallet = async (
    password: string,
    encryptedWallet: string,
  ): Promise<Record<string, any>> => {
    try {
      const key = this.generateKey(password);
      const [ivHex, encrypted] = encryptedWallet.split(':');
      const iv = Buffer.from(ivHex, 'hex');

      const decipher = createDecipheriv(ALGORITHM, key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return {
        privateKey: decrypted,
        address: this.getSVMAddressFromPrivateKey(decrypted).address,
      };
    } catch (error) {
      throw new Error(`Failed to decrypt wallet: ${error.message}`);
    }
  };

  /**
   * Fetches the SOL balance for a given address.
   */
  getSolBalance = async (
    address: string,
    rpcURL: string,
  ): Promise<Record<string, number>> => {
    try {
      const connection = new Connection(rpcURL, 'confirmed');
      const publicKey = new PublicKey(address);
      const balance = await connection.getBalance(publicKey);
      return { balance: balance / LAMPORTS_PER_SOL };
    } catch (error) {
      this.logger.error(
        `Failed to get SOL balance for ${address}:`,
        error.message,
      );
      return { balance: 0 };
    }
  };

  /**
   * Fetches the balance of an SPL token for a given address.
   */
  getSPLTokenBalance = async (
    address: string,
    tokenAddress: string,
    rpcURL: string,
    decimal: number,
  ): Promise<Record<string, number>> => {
    try {
      const connection = new Connection(rpcURL, 'confirmed');
      const publicKey = new PublicKey(address);
      const tokenMint = new PublicKey(tokenAddress);

      const associatedTokenAddress = await getAssociatedTokenAddress(
        tokenMint,
        publicKey,
        true,
      );

      const accountInfo = await connection.getAccountInfo(
        associatedTokenAddress,
      );
      if (!accountInfo) return { balance: 0 };

      const tokenAccount = await getAccount(connection, associatedTokenAddress);
      return { balance: Number(tokenAccount.amount) / 10 ** decimal };
    } catch (error) {
      this.logger.error(`Error fetching SPL token balance:`, error.message);
      return { balance: 0 };
    }
  };

  /**
   * Fetches the USDC balance specifically (uses 6 decimals).
   */
  getUSDCBalance = async (
    address: string,
    rpcURL: string,
  ): Promise<Record<string, number>> => {
    try {
      if (!process.env.USDC_MINT_ADDRESS) {
        throw new Error(
          'USDC_MINT_ADDRESS is not set in environment variables',
        );
      }

      const connection = new Connection(rpcURL, 'confirmed');
      const publicKey = new PublicKey(address);
      const tokenMint = new PublicKey(process.env.USDC_MINT_ADDRESS);

      const associatedTokenAddress = await getAssociatedTokenAddress(
        tokenMint,
        publicKey,
        true,
      );

      const accountInfo = await connection.getAccountInfo(
        associatedTokenAddress,
      );
      if (!accountInfo) return { balance: 0 };

      const tokenAccount = await getAccount(connection, associatedTokenAddress);
      const balance = Number(tokenAccount.amount) / 10 ** 6;

      return { balance };
    } catch (error: any) {
      this.logger.error(
        `ERROR fetching USDC balance for ${address}:`,
        error.message,
      );
      return { balance: 0 };
    }
  };

  /**
   * Transfers SOL from core wallet to recipient.
   */
  transferSOL = async (
    privateKey: string,
    recipientAddress: string,
    amount: number,
    rpcURL: string,
    description?: string,
  ): Promise<Record<any, unknown>> => {
    try {
      const connection = new Connection(rpcURL, 'confirmed');
      const senderKeypair = Keypair.fromSecretKey(bs58.decode(privateKey));
      const recipientPubkey = new PublicKey(recipientAddress);

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: senderKeypair.publicKey,
          toPubkey: recipientPubkey,
          lamports: amount * LAMPORTS_PER_SOL,
        }),
      );

      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [senderKeypair],
      );

      return { signature, description };
    } catch (error) {
      throw new Error(`Failed to transfer SOL: ${error.message}`);
    }
  };

  /**
   * Directly transfers SPL tokens (not gasless).
   */
  transferSPLToken = async (
    privateKey: string,
    recipientAddress: string,
    amount: number,
    tokenAddress: string,
    rpcURL: string,
    decimal: number,
    description?: string,
  ): Promise<Record<any, unknown>> => {
    try {
      const connection = new Connection(rpcURL, 'confirmed');
      const senderKeypair = Keypair.fromSecretKey(bs58.decode(privateKey));
      const recipientPubkey = new PublicKey(recipientAddress);
      const tokenMint = new PublicKey(tokenAddress);

      const senderATA = await getAssociatedTokenAddress(
        tokenMint,
        senderKeypair.publicKey,
      );

      const recipientATA = await getOrCreateAssociatedTokenAccount(
        connection,
        senderKeypair,
        tokenMint,
        recipientPubkey,
      );

      const transaction = new Transaction().add(
        createTransferInstruction(
          senderATA,
          recipientATA.address,
          senderKeypair.publicKey,
          amount * 10 ** decimal,
          [],
          TOKEN_PROGRAM_ID,
        ),
      );

      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [senderKeypair],
      );

      return { signature, description };
    } catch (error) {
      throw new Error(`Failed to transfer SPL token: ${error.message}`);
    }
  };

  /**
   * Builds a token transfer transaction without sending it.
   * Useful for external fee paying or manual signing.
   */
  builtTokenTranferTx = async (
    privateKey: string,
    recipientAddress: string,
    amount: number,
    tokenAddress: string,
    rpcURL: string,
    decimal: number,
  ): Promise<Transaction> => {
    try {
      const connection = new Connection(rpcURL, 'confirmed');
      const senderKeypair = Keypair.fromSecretKey(bs58.decode(privateKey));
      const recipientPubkey = new PublicKey(recipientAddress);
      const tokenMint = new PublicKey(tokenAddress);

      const senderATA = await getAssociatedTokenAddress(
        tokenMint,
        senderKeypair.publicKey,
      );

      const recipientATA = await getOrCreateAssociatedTokenAccount(
        connection,
        senderKeypair,
        tokenMint,
        recipientPubkey,
      );

      const transaction = new Transaction().add(
        createTransferInstruction(
          senderATA,
          recipientATA.address,
          senderKeypair.publicKey,
          amount * 10 ** decimal,
          [],
          TOKEN_PROGRAM_ID,
        ),
      );

      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = senderKeypair.publicKey;

      return transaction;
    } catch (error) {
      throw new Error(`Failed to build transfer transaction: ${error.message}`);
    }
  };
}
