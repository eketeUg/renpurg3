export const welcomeMessageMarkup = async (
  userName: string,
  walletAddress: string,
  solBalance: string,
  usdcBalance: string,
) => {
  return {
    message: `Hello @${userName} 👋\n\nWelcome to <b>K-gasless bot</b> \nA kora gasless transaction demo bot ⚡️\nThis bot allows users to send tokens(USDC) to other users or wallet without needing SOL!\n\n👉🏻 <b>Start To Use</b>:\n- Fund your wallet with a USDC faucet only.\n- go to <a href="https://faucet.circle.com/">Circle usdc faucet</a>\n- copy your wallet address and paste it there  to get a USDC faucet\n\n🚨 Notice 🚨\nNote this bot is just a demo bot to test kora gasless transaction feature. \nAs a result, only USDC testnet tokens should be sent to it.\n\n<b>wallet address:</b> <code>${walletAddress}</code>\n<b>balance:</b> ${solBalance} SOL | ${usdcBalance} USDC`,

    keyboard: [
      [
        {
          text: '☰ menu',
          callback_data: JSON.stringify({
            command: '/menu',
            language: 'english',
          }),
        },
      ],
      [
        {
          text: '📢 Share',
          switch_inline_query:
            'Kora-gasless bot, the ultimate demo bot for Kora gasless transactions! 🚀⚡ ️',
        },
      ],
      // [
      //   {
      //     text: '❓ Help & Support',
      //     url: `https://t.me/+uvluoEnCbiU5YTBk`,
      //   },
      // ],
    ],
  };
};
