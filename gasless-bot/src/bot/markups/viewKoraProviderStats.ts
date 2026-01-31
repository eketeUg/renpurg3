export const showKoraNodeStatsMarkup = async () => {
  let message = `<b>Current Kora Provider :</b><a href="${process.env.SOLANA_SCAN_URL}address/${process.env.KORA_PROVIDER_PUBKEY}?cluster=devnet">${process.env.KORA_PROVIDER_PUBKEY}</a>\n\n`;

  message += `➤ Kora gasless transactions is powered by renpurg3Bot 🤖 node provider, check it out \n`;

  return {
    message,
    keyboard: [
      [
        {
          text: 'View renpurg3Bot',
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
