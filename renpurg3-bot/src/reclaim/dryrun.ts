import { Connection, PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';

dotenv.config();

const connection = new Connection(process.env.SOLANA_RPC_URL!, 'confirmed');

const yourWallet = new PublicKey(
  '7eBmtW8CG1zJ6mEYbTpbLRtjD1BLHdQdU5Jc8Uip42eE',
);

// ATA Program
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

type Result = {
  signature: string;
  ata: string;
  mint: string;
  owner: string;
  closeAuthority: string | null;
  rentPaidLamports: bigint;
  estimatedClaimableLamports: bigint;
  timestamp?: number;
};

async function findATAsYouPaidFor(
  limit = 50,
  targetMint?: string, // optional filter
): Promise<Result[]> {
  let rentExemptLamports = 0n;

  try {
    rentExemptLamports = BigInt(
      await connection.getMinimumBalanceForRentExemption(165),
    );
  } catch {}

  console.log(
    `Rent-exempt ATA: ${rentExemptLamports} lamports (~${(
      Number(rentExemptLamports) / 1e9
    ).toFixed(9)} SOL)`,
  );

  const signatures = await connection.getSignaturesForAddress(yourWallet, {
    limit,
  });

  const results: Result[] = [];

  for (const sigInfo of signatures) {
    if (sigInfo.err) continue;

    const tx = await connection.getParsedTransaction(sigInfo.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

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
      if (pre === 0 && post > 0) {
        const tokenBalance = tx.meta.postTokenBalances?.find(
          (b) => b.accountIndex === idx,
        );

        if (!tokenBalance) continue;

        // Optional mint filter
        if (targetMint && tokenBalance.mint !== targetMint) continue;

        const ataPubkey = acc.pubkey;

        const rentPaid = BigInt(post) - BigInt(pre);
        const claimable =
          rentExemptLamports > 0n ? rentExemptLamports : BigInt(post);

        let ataOwner = 'unknown';
        let closeAuthority: string | null = null;

        try {
          const info = await connection.getParsedAccountInfo(ataPubkey);

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

        results.push({
          signature: sigInfo.signature,
          ata: ataPubkey.toBase58(),
          mint: tokenBalance.mint,
          owner: ataOwner,
          closeAuthority,
          rentPaidLamports: rentPaid,
          estimatedClaimableLamports: claimable,
          timestamp: sigInfo.blockTime ?? 0,
        });

        console.log(
          `ATA Found: ${ataPubkey.toBase58()}\n` +
            ` Mint            : ${tokenBalance.mint}\n` +
            ` Owner           : ${ataOwner}\n` +
            ` Close Authority : ${closeAuthority ?? '(owner)'}\n` +
            ` Rent Paid       : ${rentPaid} lamports\n` +
            ` Claimable       : ${claimable} lamports\n`,
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
}

// ✅ Find ALL token ATAs you paid for
findATAsYouPaidFor(100);

// ✅ OR only one mint
// findATAsYouPaidFor(100, "So11111111111111111111111111111111111111112");
