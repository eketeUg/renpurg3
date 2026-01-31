import { Connection, PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';

dotenv.config();

const connection = new Connection(process.env.SOLANA_RPC_URL!, 'confirmed');
const yourWallet = new PublicKey(
  '7eBmtW8CG1zJ6mEYbTpbLRtjD1BLHdQdU5Jc8Uip42eE',
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);
const USDC_MINT_DEVNET = new PublicKey(
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
);

async function findUSDCATAsYouPaidFor(limit = 50) {
  // Current rent-exempt minimum for ATA (165 bytes)
  let rentExemptLamports = 0n;
  try {
    rentExemptLamports = BigInt(
      await connection.getMinimumBalanceForRentExemption(165),
    );
    console.log(
      `Rent-exempt minimum for ATA: ${rentExemptLamports} lamports ` +
        `(≈ ${(Number(rentExemptLamports) / 1e9).toFixed(9)} SOL)`,
    );
  } catch (err) {
    console.warn('Failed to get rent-exempt value:', err);
  }

  const signatures = await connection.getSignaturesForAddress(yourWallet, {
    limit,
  });

  const results: {
    signature: string;
    ata: string;
    mint: string;
    owner: string;
    closeAuthority: string | null;
    rentPaidLamports: bigint;
    estimatedClaimableLamports: bigint;
    timestamp?: number;
  }[] = [];

  for (const sigInfo of signatures) {
    if (sigInfo.err) continue;

    const tx = await connection.getParsedTransaction(sigInfo.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx) continue;

    const hasAtaProgram = tx.transaction.message.accountKeys.some((acc) =>
      acc.pubkey.equals(ASSOCIATED_TOKEN_PROGRAM_ID),
    );
    if (!hasAtaProgram) continue;

    if (!tx.meta?.preBalances || !tx.meta?.postBalances) continue;

    for (const [idx, acc] of tx.transaction.message.accountKeys.entries()) {
      const pre = tx.meta.preBalances[idx];
      const post = tx.meta.postBalances[idx];

      if (pre === 0 && post > 0) {
        const potentialATA = acc.pubkey;

        const tokenBalance = tx.meta?.postTokenBalances?.find(
          (b) => b.accountIndex === idx && b.uiTokenAmount.uiAmount !== null,
        );

        if (tokenBalance && tokenBalance.mint === USDC_MINT_DEVNET.toBase58()) {
          const rentPaid = BigInt(post) - BigInt(pre);

          const claimable =
            rentExemptLamports > 0n ? rentExemptLamports : BigInt(post);

          // Fetch current ATA state to get owner & close authority
          let ataOwner = 'unknown';
          let closeAuthority: string | null = null;

          try {
            const accountInfo = await connection.getParsedAccountInfo(
              potentialATA,
              'confirmed',
            );

            if (
              accountInfo.value &&
              'parsed' in accountInfo.value.data &&
              accountInfo.value.data.parsed.type === 'account'
            ) {
              const parsedInfo = accountInfo.value.data.parsed.info;
              ataOwner = parsedInfo.owner;

              // closeAuthority can be null / undefined if not set
              closeAuthority = parsedInfo.closeAuthority ?? null;
            }
          } catch (fetchErr) {
            console.warn(
              `Failed to fetch ATA info for ${potentialATA.toBase58()}:`,
              fetchErr,
            );
          }

          results.push({
            signature: sigInfo.signature,
            ata: potentialATA.toBase58(),
            mint: tokenBalance.mint,
            owner: ataOwner,
            closeAuthority,
            rentPaidLamports: rentPaid,
            estimatedClaimableLamports: claimable,
            timestamp: sigInfo.blockTime ?? 0,
          });

          console.log(
            `USDC ATA in tx ${sigInfo.signature}:`,
            potentialATA.toBase58(),
            '\n  Owner           :',
            ataOwner,
            '\n  Close Authority :',
            closeAuthority ?? '(not set → owner can close)',
            '\n  Rent paid       :',
            rentPaid.toString(),
            'lamports',
            '\n  Claimable       :',
            claimable.toString(),
            'lamports (if balance=0)',
            '\n  Time            :',
            new Date((sigInfo.blockTime ?? 0) * 1000).toISOString(),
          );
        }
      }
    }
  }

  console.log('\nSummary - USDC ATAs you likely paid to create:');
  if (results.length === 0) {
    console.log(
      'None found in last',
      limit,
      'txs. Try increasing limit or paginate.',
    );
  } else {
    console.log(results);
    const totalClaimable = results.reduce(
      (sum, r) => sum + r.estimatedClaimableLamports,
      0n,
    );
    console.log(
      `Total potential claimable rent (if all empty & closable): ${totalClaimable} lamports ` +
        `≈ ${(Number(totalClaimable) / 1e9).toFixed(6)} SOL`,
    );
  }

  return results;
}

findUSDCATAsYouPaidFor(50).catch(console.error);
