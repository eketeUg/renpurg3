import { Injectable, Logger } from '@nestjs/common';
import { KoraClient } from '@solana/kora';
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

/**
 * Service for identifying reclaimable rent from sponsored Solana accounts.
 * Scans transaction history for ATA creations and checks their current status.
 */
@Injectable()
export class ReclaimService {
  private readonly logger = new Logger(ReclaimService.name);

  private koraClient: KoraClient;
  private connection: Connection;

  constructor() {
    this.connection = new Connection(process.env.SOLANA_RPC_URL!, 'confirmed');
    this.koraClient = new KoraClient({
      rpcUrl: process.env.KORA_RPC_URL!,
    });
  }

  /**
   * Scans the transaction history of a provider wallet to find sponsored ATAs.
   * @param providerWallet The public key of the Kora node provider fee payer.
   * @param limit Number of transactions to scan back.
   * @param targetMint Optional filter for specific token mints.
   */
  async scanProviderWallet(
    providerWallet: string,
    limit = 50,
    targetMint?: string,
  ): Promise<Result[]> {
    try {
      const publicKey = new PublicKey(providerWallet);
      const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
        'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      );

      const rentExemptLamports = BigInt(
        await this.connection.getMinimumBalanceForRentExemption(165),
      );

      const signatures = await this.connection.getSignaturesForAddress(
        publicKey,
        { limit },
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

        // Check if the transaction involved the Associated Token Program
        const hasAtaProgram = tx.transaction.message.accountKeys.some((k) =>
          k.pubkey.equals(ASSOCIATED_TOKEN_PROGRAM_ID),
        );
        if (!hasAtaProgram) continue;

        if (!tx.meta?.preBalances || !tx.meta?.postBalances) continue;

        // Inspect account creation events within the transaction
        for (const [idx, acc] of tx.transaction.message.accountKeys.entries()) {
          const pre = tx.meta.preBalances[idx];
          const post = tx.meta.postBalances[idx];

          // Identification logic: 0 pre-balance and positive post-balance indicates creation
          if (pre === 0 && post > 0) {
            const tokenBalance = tx.meta.postTokenBalances?.find(
              (b) => b.accountIndex === idx,
            );

            if (!tokenBalance) continue;
            if (targetMint && tokenBalance.mint !== targetMint) continue;

            const ataPubkey = acc.pubkey;
            const rentPaid = BigInt(post) - BigInt(pre);

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
            } catch {
              this.logger.warn(
                `Failed to parse account info for ${ataPubkey.toBase58()}`,
              );
            }

            // Exclude accounts where the provider is the owner (only sponsored for others)
            if (ataOwner === providerWallet) continue;

            // Status is claimable if the current balance is 0
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
              estimatedClaimableLamports: rentExemptLamports,
              timestamp: sigInfo.blockTime ?? 0,
              status: isClaimable ? 'claimable' : 'active',
            });
          }
        }
      }

      return results;
    } catch (error) {
      this.logger.error(
        `Error scanning provider wallet ${providerWallet}: ${error.message}`,
      );
      throw error;
    }
  }
}
