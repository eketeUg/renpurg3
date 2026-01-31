// import { Connection, PublicKey } from '@solana/web3.js';

// const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
// const yourWallet = new PublicKey(
//   '7eBmtW8CG1zJ6mEYbTpbLRtjD1BLHdQdU5Jc8Uip42eE',
// );
// const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
//   'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
// );
// const USDC_MINT_DEVNET = new PublicKey(
//   '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
// );

// async function findUSDCATAsYouPaidFor(limit = 50) {
//   const signatures = await connection.getSignaturesForAddress(yourWallet, {
//     limit,
//   });

//   const results: {
//     signature: string;
//     ata: string;
//     mint: string;
//     owner?: string;
//     timestamp?: number;
//   }[] = [];

//   for (const sigInfo of signatures) {
//     if (sigInfo.err) continue;

//     const tx = await connection.getParsedTransaction(sigInfo.signature, {
//       maxSupportedTransactionVersion: 0,
//       commitment: 'confirmed',
//     });

//     if (!tx) continue;

//     // Quick filter: skip if Associated Token Program not involved
//     const hasAtaProgram = tx.transaction.message.accountKeys.some((acc) =>
//       acc.pubkey.equals(ASSOCIATED_TOKEN_PROGRAM_ID),
//     );
//     if (!hasAtaProgram) continue;

//     // Look for new accounts that received rent from your wallet (pre=0 → post>0)
//     if (!tx.meta?.preBalances || !tx.meta?.postBalances) continue;

//     tx.transaction.message.accountKeys.forEach((acc, idx) => {
//       const pre = tx.meta!.preBalances![idx];
//       const post = tx.meta!.postBalances![idx];

//       if (pre === 0 && post > 0) {
//         const potentialATA = acc.pubkey;

//         // Optional: Check if it's exactly 165 bytes (ATA size), but RPC doesn't give size here → we check token balance changes instead

//         // Better: Look in postTokenBalances for this account
//         const tokenBalance = tx.meta?.postTokenBalances?.find(
//           (b) => b.accountIndex === idx && b.uiTokenAmount.uiAmount !== null,
//         );

//         if (tokenBalance && tokenBalance.mint === USDC_MINT_DEVNET.toBase58()) {
//           // This is a USDC ATA that was funded (likely created)
//           // Owner is usually in tokenBalance.owner
//           results.push({
//             signature: sigInfo.signature,
//             ata: potentialATA.toBase58(),
//             mint: tokenBalance.mint,
//             owner: tokenBalance.owner,
//             timestamp: sigInfo.blockTime ?? 0,
//           });

//           console.log(
//             `Found USDC ATA creation in tx ${sigInfo.signature}:`,
//             potentialATA.toBase58(),
//             'Owner:',
//             tokenBalance.owner,
//             'Time:',
//             new Date((sigInfo.blockTime ?? 0) * 1000).toISOString(),
//           );
//         }
//       }
//     });

//     // Fallback: check logs for "Create" if token balances miss it
//     if (
//       tx.meta?.logMessages?.some(
//         (log) =>
//           log.includes('Create') &&
//           log.includes('Associated') &&
//           log.includes('success'),
//       )
//     ) {
//       // You could add more parsing here if needed, but tokenBalances are more reliable
//     }
//   }

//   return results;
// }

// findUSDCATAsYouPaidFor(50)
//   .then((found) => {
//     console.log('USDC ATAs you likely paid to create:');
//     console.log(found);
//   })
//   .catch(console.error);

import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
} from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
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
  // Get current rent-exempt minimum for a standard ATA (165 bytes)
  let rentExemptLamports = 0n;
  try {
    rentExemptLamports = BigInt(
      await connection.getMinimumBalanceForRentExemption(165),
    );
    console.log(
      `Current rent-exempt minimum for ATA (165 bytes): ${rentExemptLamports} lamports ` +
        `≈ ${(Number(rentExemptLamports) / 1_000_000_000).toFixed(9)} SOL`,
    );
  } catch (err) {
    console.warn('Could not fetch rent-exempt value:', err);
  }

  const signatures = await connection.getSignaturesForAddress(yourWallet, {
    limit,
  });

  const results: {
    signature: string;
    ata: string;
    mint: string;
    owner?: string;
    rentPaidLamports: bigint;
    estimatedClaimableLamports: bigint;
    timestamp?: number;
  }[] = [];

  for (const sigInfo of signatures) {
    if (sigInfo.err) continue;

    const tx = (await connection.getParsedTransaction(sigInfo.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    })) as ParsedTransactionWithMeta | null;

    if (!tx) continue;

    // Quick filter: skip if no Associated Token Program
    const hasAtaProgram = tx.transaction.message.accountKeys.some((acc) =>
      acc.pubkey.equals(ASSOCIATED_TOKEN_PROGRAM_ID),
    );
    if (!hasAtaProgram) continue;

    if (!tx.meta?.preBalances || !tx.meta?.postBalances) continue;

    tx.transaction.message.accountKeys.forEach((acc, idx) => {
      const pre = tx.meta!.preBalances![idx];
      const post = tx.meta!.postBalances![idx];

      if (pre === 0 && post > 0) {
        const potentialATA = acc.pubkey;

        const tokenBalance = tx.meta?.postTokenBalances?.find(
          (b) => b.accountIndex === idx && b.uiTokenAmount.uiAmount !== null,
        );

        if (tokenBalance && tokenBalance.mint === USDC_MINT_DEVNET.toBase58()) {
          const rentPaid = BigInt(post) - BigInt(pre); // should ≈ rentExemptLamports

          // Estimated claimable: usually full rent-exempt amount (minus close tx fee ~0.000005 SOL)
          // For simplicity we show full rent-exempt as potential refund
          const claimable =
            rentExemptLamports > 0n ? rentExemptLamports : BigInt(post);

          results.push({
            signature: sigInfo.signature,
            ata: potentialATA.toBase58(),
            mint: tokenBalance.mint,
            owner: tokenBalance.owner,
            rentPaidLamports: rentPaid,
            estimatedClaimableLamports: claimable,
            timestamp: sigInfo.blockTime ?? 0,
          });

          console.log(
            `Found USDC ATA creation in tx ${sigInfo.signature}:`,
            potentialATA.toBase58(),
            'Owner:',
            tokenBalance.owner || 'unknown',
            'Rent paid:',
            rentPaid.toString(),
            'lamports',
            '≈',
            (Number(rentPaid) / 1_000_000_000).toFixed(9),
            'SOL',
            'Claimable (if empty):',
            claimable.toString(),
            'lamports',
            'Time:',
            new Date((sigInfo.blockTime ?? 0) * 1000).toISOString(),
          );
        }
      }
    });
  }

  console.log('\nSummary - USDC ATAs you likely paid to create:');
  if (results.length === 0) {
    console.log(
      'No USDC ATA creations found in the last',
      limit,
      'transactions.',
    );
  } else {
    console.log(results);
    const totalClaimable = results.reduce(
      (sum, r) => sum + r.estimatedClaimableLamports,
      0n,
    );
    console.log(
      `Total potential claimable rent (if all empty): ${totalClaimable} lamports ` +
        `≈ ${(Number(totalClaimable) / 1_000_000_000).toFixed(6)} SOL`,
    );
  }

  return results;
}

findUSDCATAsYouPaidFor(50).catch(console.error);
