export const showKoraNodeStatsMarkup = async (data: any[]) => {
  let message = `<b>🧾 RentPurg3 – Reclaimable ATA Scan</b>\n\n`;

  if (!data || data.length === 0) {
    message += `No reclaimable ATAs found.\n\n`;
  } else {
    // 🔹 Sum all claimable lamports
    const totalLamports = data.reduce(
      (sum, r) => sum + BigInt(r.estimatedClaimableLamports),
      0n,
    );

    const totalSol = Number(totalLamports) / 1e9;

    // Count claimable vs active
    const claimableCount = data.filter((r) => r.status === 'claimable').length;
    const activeCount = data.length - claimableCount;

    message += `💰 <b>Total Claimable:</b> ${totalSol.toFixed(6)} SOL\n`;
    message += `📦 <b>ATAs Found:</b> ${data.length} (Claimable: ${claimableCount}, Active: ${activeCount})\n\n`;

    for (const [i, r] of data.entries()) {
      const rentSol = Number(r.estimatedClaimableLamports) / 1e9;

      message +=
        `<b>#${i + 1}</b>\n` +
        `🔹 <b>Tx:</b> <a href="${process.env.SOLANA_SCAN_URL}tx/${r.tx}?cluster=devnet">${short(r.tx, 6)}</a>\n` +
        `🔹 <b>Mint:</b> <a href="${process.env.SOLANA_SCAN_URL}address/${r.mint}?cluster=devnet">${short(r.mint)}</a>\n` +
        `🔹 <b>ATA:</b> <a href="${process.env.SOLANA_SCAN_URL}address/${r.ata}?cluster=devnet">${short(r.ata)}</a>\n` +
        `🔹 <b>Owner:</b> <a href="${process.env.SOLANA_SCAN_URL}address/${r.owner}?cluster=devnet">${short(r.owner)}</a>\n` +
        `🔹 <b>Close Auth:</b> ${
          r.closeAuthority
            ? `<a href="${process.env.SOLANA_SCAN_URL}address/${r.closeAuthority}?cluster=devnet">${short(r.closeAuthority)}</a>`
            : 'Owner'
        }\n` +
        `💰 <b>Claimable:</b> ${rentSol.toFixed(6)} SOL\n` +
        `🕒 <b>Time:</b> ${new Date(r.timestamp * 1000).toUTCString()}\n` +
        `📌 <b>Status:</b> ${r.status}\n\n`;
    }
  }

  message += `➤ Kora gasless transactions powered by <b>rentpurg3Bot 🤖</b>\n`;

  return {
    message,
    keyboard: [
      [
        {
          text: 'View rentpurg3Bot',
          url: `https://t.me/renpurg3Bot`,
        },
      ],
      [
        {
          text: 'Close ❌',
          callback_data: JSON.stringify({
            command: '/close',
            language: 'english',
          }),
        },
      ],
    ],
  };
};

/* ---------------------------------- */
/* Helpers                            */
/* ---------------------------------- */

function short(address: string, chars = 4) {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
