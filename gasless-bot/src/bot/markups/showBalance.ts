export const showBalanceMarkup = async (
  solBalance: string,
  usdcBalance: string,
) => {
  let message = `<b>Wallet Balance</b>\n\n`;

  message += `➤ ${solBalance} <b>SOL</b> (Solana)\n`;
  message += `➤ ${usdcBalance} <b>USDC</b> (Solana)\n`;

  return {
    message,
    keyboard: [
      [
        {
          text: 'Fund wallet 💵',
          callback_data: JSON.stringify({
            command: '/fundWallet',
            language: 'english',
          }),
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
