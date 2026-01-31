import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

const KORA_OPERATOR_WALLET = new PublicKey(
  'HJ6421bZ1bFc17W5HzTtogpkzVDfh7pCUoGdzhM4AEkz',
);

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

/**
 * Identify accounts sponsored by Kora and check if they are reclaimable.
 */
async function dryRunReclaim() {
  console.log(
    `--- Starting Kora Rent-Reclaim Scan for: ${KORA_OPERATOR_WALLET.toBase58()} ---\n`,
  );

  // 1. Get recent transactions for the operator
  const signatures = await connection.getSignaturesForAddress(
    KORA_OPERATOR_WALLET,
    { limit: 20 },
  );

  let totalPotentialRecovery = 0;

  for (const sigInfo of signatures) {
    const tx: ParsedTransactionWithMeta | null =
      await connection.getParsedTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
      });

    if (!tx || tx.meta?.err) continue;

    const feePayer = tx.transaction.message.accountKeys[0].pubkey;
    if (!feePayer.equals(KORA_OPERATOR_WALLET)) continue;

    // --- 2. Check main instructions ---
    const instructions = tx.transaction.message.instructions as any[];
    for (const ix of instructions) {
      if (
        ix.program === 'spl-token' &&
        ix.parsed?.type === 'initializeAccount'
      ) {
        const candidateAcc = new PublicKey(ix.parsed.info.account);

        await checkAndReportAccount(
          candidateAcc,
          TOKEN_PROGRAM_ID,
          'SPL Token',
        );
      }
    }

    // --- 3. Check inner instructions for system.createAccount ---
    const innerInstructions = tx.meta?.innerInstructions ?? [];
    for (const inner of innerInstructions) {
      for (const ix of inner.instructions as any[]) {
        if (ix.program === 'system' && ix.parsed?.type === 'createAccount') {
          const candidateAcc = new PublicKey(ix.parsed.info.newAccount);
          const SYSTEM_PROGRAM_ID = new PublicKey(
            '11111111111111111111111111111111',
          );

          await checkAndReportAccount(
            candidateAcc,
            SYSTEM_PROGRAM_ID,
            'System Account',
          );
        }
      }
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(
    `Potential SOL to Reclaim: ${totalPotentialRecovery.toFixed(6)} SOL`,
  );

  async function checkAndReportAccount(
    candidateAcc: PublicKey,
    expectedOwner: PublicKey,
    label: string,
  ) {
    const accountInfo = await connection.getParsedAccountInfo(candidateAcc);
    if (!accountInfo.value) return;

    const { lamports, owner, data } = accountInfo.value;

    // Make sure this is parsed data, not raw bytes
    if (typeof data === 'object' && 'parsed' in data) {
      const parsedInfo = (data as any).parsed?.info;

      // For SPL Token accounts, check token balance
      const balance = parsedInfo?.tokenAmount?.uiAmount ?? 0;

      if (owner.equals(expectedOwner) && balance === 0) {
        const rent = lamports / 1e9;
        console.log(
          `[RECLAIMABLE] ${label}: ${candidateAcc.toBase58()} | Rent: ${rent.toFixed(6)} SOL`,
        );
        totalPotentialRecovery += rent;
      }
    } else {
      // For raw system accounts, just check owner and lamports
      if (owner.equals(expectedOwner) && lamports > 0) {
        const rent = lamports / 1e9;
        console.log(
          `[RECLAIMABLE] ${label}: ${candidateAcc.toBase58()} | Rent: ${rent.toFixed(6)} SOL`,
        );
        totalPotentialRecovery += rent;
      }
    }
  }
}

dryRunReclaim();
