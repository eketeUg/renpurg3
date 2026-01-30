import { Injectable } from '@nestjs/common';
import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

@Injectable()
export class ReclaimService {
  async findSponsoredAccounts(operatorPubKey: PublicKey) {
    const connection = new Connection('https://api.devnet.solana.com', {
      commitment: 'confirmed',
    });
    const signatures = await connection.getSignaturesForAddress(operatorPubKey);

    for (const sigInfo of signatures) {
      const tx = await connection.getParsedTransaction(sigInfo.signature);
      if (
        tx?.transaction.message.accountKeys[0].pubkey.equals(operatorPubKey)
      ) {
        // This transaction was sponsored by the operator
        // Now parse instructions to see if a 'CreateAccount' occurred
      }
    }
  }
}
