export const allFeaturesMarkup = async () => {
  return {
    message: `Please Select any action below 👇\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003 : `,
    keyboard: [
      [
        {
          text: '💳 Wallet',
          callback_data: JSON.stringify({
            command: '/walletDetails',
            language: 'english',
          }),
        },
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
          text: 'Send USDC',
          callback_data: JSON.stringify({
            command: '/sendUSDC',
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
