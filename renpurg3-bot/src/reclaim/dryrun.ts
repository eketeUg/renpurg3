import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

const KORA_OPERATOR_WALLET = new PublicKey(
  '3Z1Ef7YaxK8oUMoi6exf7wYZjZKWJJsrzJXSt1c3qrDE',
);
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

/**
 * Identify accounts sponsored by Kora and check if they are reclaimable.
 */
async function dryRunReclaim() {
  console.log(
    `--- Starting Kora Rent-Reclaim Scan for: ${KORA_OPERATOR_WALLET.toBase58()} ---\n`,
  );

  // 1. Get transaction history for the operator (Kora Node)
  const signatures = await connection.getSignaturesForAddress(
    KORA_OPERATOR_WALLET,
    { limit: 50 },
  );

  let totalPotentialRecovery = 0;

  for (const sigInfo of signatures) {
    const tx = await connection.getParsedTransaction(sigInfo.signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx || tx.meta?.err) continue;

    // Check if Kora was the Fee Payer
    const feePayer = tx.transaction.message.accountKeys[0].pubkey;
    if (feePayer.equals(KORA_OPERATOR_WALLET)) {
      // 2. Identify newly created accounts in this transaction
      // We look for 'InitializeAccount' or 'Create' instructions
      const instructions = tx.transaction.message.instructions;

      for (const ix of instructions) {
        // Simplified: Logic to identify candidate accounts (e.g., ATAs)
        // In a full build, you'd parse innerInstructions for 'SystemProgram.createAccount'
        // For this dry-run, we'll assume we found a candidate address 'candidateAcc'

        const candidateAcc = new PublicKey('...'); // Extracted from IX

        // 3. Safety Check: Is it empty?
        const accountInfo = await connection.getParsedAccountInfo(candidateAcc);

        if (accountInfo.value?.owner.equals(TOKEN_PROGRAM_ID)) {
          const data = (accountInfo.value.data as any).parsed.info;
          const balance = data.tokenAmount.uiAmount;

          if (balance === 0) {
            const rent = accountInfo.value.lamports / 1e9;
            console.log(
              `[RECLAIMABLE] Account: ${candidateAcc.toBase58()} | Rent: ${rent} SOL`,
            );
            totalPotentialRecovery += rent;
          }
        }
      }
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(
    `Potential SOL to Reclaim: ${totalPotentialRecovery.toFixed(4)} SOL`,
  );
}

dryRunReclaim();
