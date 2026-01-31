export const walletDetailsMarkup = async (
  svmAddress?: string,
  balanceSol?: string,
  balanceUsdc?: string,
) => {
  const keyboard: any[] = [];

  if (svmAddress) {
    keyboard.push([
      {
        text: '🔎 View on solscan explorer',
        url: `${process.env.SOLANA_SCAN_URL}address/${svmAddress}?cluster=devnet`,
      },
    ]);
  }

  keyboard.push([
    {
      text: 'Close ❌',
      callback_data: JSON.stringify({
        command: '/close',
        language: 'english',
      }),
    },
  ]);
  return {
    message: `<b>Your Wallet</b>\n\n
  ${svmAddress ? `<b>Address:</b> <code>${svmAddress}</code>\n  Balance: ${balanceSol} SOL\n  Balance: ${balanceUsdc} USDC` : ''}\nTap to copy the address and send tokens to deposit.`,
    keyboard,
  };
};
