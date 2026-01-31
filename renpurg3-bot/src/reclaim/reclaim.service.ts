import { Injectable, Logger } from '@nestjs/common';
import { KoraClient } from '@solana/kora';
import { Rpc, SolanaRpcApi } from '@solana/kit';

import { Connection, PublicKey } from '@solana/web3.js';

export type Result = {
  tx: string; // transaction signature that created the ATA
  ata: string; // ATA account address
  mint: string; // token mint
  owner: string; // owner of the ATA
  closeAuthority: string | null; // who can close it
  rentPaidLamports: bigint; // lamports paid to create ATA
  estimatedClaimableLamports: bigint; // rent claimable if ATA balance=0
  timestamp?: number; // block time
  status: 'claimable' | 'active'; // whether the account is empty and can be closed
};
@Injectable()
export class ReclaimService {
  private readonly logger = new Logger(ReclaimService.name);

  private koraClient: KoraClient;
  private rpc: Rpc<SolanaRpcApi>;
  private kora_signer: any;
  private connection: Connection;

  constructor() {
    this.connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');

    this.koraClient = new KoraClient({
      rpcUrl: process.env.KORA_RPC_URL,
    });
    this.kora_signer = this.koraClient.getPayerSigner();
  }

  async scanProviderWallet(
    providerWallet: string,
    limit = 50,
    targetMint?: string,
  ): Promise<any> {
    console.log(`Scanning provider wallet: ${providerWallet} ...`);
    const publicKey = new PublicKey(providerWallet);
    // ATA Program
    const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    );
    let rentExemptLamports = 0n;
    try {
      rentExemptLamports = BigInt(
        await this.connection.getMinimumBalanceForRentExemption(165),
      );

      console.log(
        `Rent-exempt ATA: ${rentExemptLamports} lamports (~${(
          Number(rentExemptLamports) / 1e9
        ).toFixed(9)} SOL)`,
      );

      const signatures = await this.connection.getSignaturesForAddress(
        publicKey,
        {
          limit,
        },
      );

      const results: Result[] = [];

      for (const sigInfo of signatures) {
        if (sigInfo.err) continue;

        const tx = await this.connection.getParsedTransaction(
          sigInfo.signature,
          {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed',
          },
        );

        if (!tx) continue;

        // Must involve ATA program
        const hasAtaProgram = tx.transaction.message.accountKeys.some((k) =>
          k.pubkey.equals(ASSOCIATED_TOKEN_PROGRAM_ID),
        );
        if (!hasAtaProgram) continue;

        if (!tx.meta?.preBalances || !tx.meta?.postBalances) continue;

        for (const [idx, acc] of tx.transaction.message.accountKeys.entries()) {
          const pre = tx.meta.preBalances[idx];
          const post = tx.meta.postBalances[idx];

          // New account created
          // New account created
          if (pre === 0 && post > 0) {
            const tokenBalance = tx.meta.postTokenBalances?.find(
              (b) => b.accountIndex === idx,
            );

            if (!tokenBalance) continue;

            // Optional mint filter
            if (targetMint && tokenBalance.mint !== targetMint) continue;

            const ataPubkey = acc.pubkey;

            const rentPaid = BigInt(post) - BigInt(pre);
            const claimableLamports =
              rentExemptLamports > 0n ? rentExemptLamports : BigInt(post);

            let ataOwner = 'unknown';
            let closeAuthority: string | null = null;

            try {
              const info =
                await this.connection.getParsedAccountInfo(ataPubkey);

              if (
                info.value &&
                'parsed' in info.value.data &&
                info.value.data.parsed.type === 'account'
              ) {
                const parsed = info.value.data.parsed.info;
                ataOwner = parsed.owner;
                closeAuthority = parsed.closeAuthority ?? null;
              }
            } catch {}

            // Only keep ATAs created for others
            if (ataOwner === providerWallet) continue;

            // Determine status: claimable if balance = 0
            const isClaimable =
              tokenBalance.uiTokenAmount.uiAmount === 0 ||
              tokenBalance.uiTokenAmount.uiAmount === null;

            results.push({
              tx: sigInfo.signature,
              ata: ataPubkey.toBase58(),
              mint: tokenBalance.mint,
              owner: ataOwner,
              closeAuthority,
              rentPaidLamports: rentPaid,
              estimatedClaimableLamports: claimableLamports,
              timestamp: sigInfo.blockTime ?? 0,
              status: isClaimable ? 'claimable' : 'active',
            });

            console.log(
              `ATA Found (paid for other): ${ataPubkey.toBase58()}\n` +
                ` Tx              : ${sigInfo.signature}\n` +
                ` Mint            : ${tokenBalance.mint}\n` +
                ` Owner           : ${ataOwner}\n` +
                ` Close Authority : ${closeAuthority ?? '(owner)'}\n` +
                ` Rent Paid       : ${rentPaid} lamports\n` +
                ` Claimable       : ${claimableLamports} lamports\n` +
                ` Status          : ${isClaimable ? 'claimable' : 'active'}\n`,
            );
          }
        }
      }

      console.log('\nSummary');
      console.log(results);

      const total = results.reduce(
        (sum, r) => sum + r.estimatedClaimableLamports,
        0n,
      );

      console.log(
        `Total potential reclaimable rent: ${total} lamports (~${(
          Number(total) / 1e9
        ).toFixed(6)} SOL)`,
      );

      return results;
    } catch (error) {
      this.logger.error(
        `Error scanning provider wallet ${providerWallet}: ${error.message}`,
      );
      throw error;
    }
  }
}
