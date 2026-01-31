export const welcomeMessageMarkup = async (userName: string) => {
  return {
    message: `Hello @${userName} 👋\n\nWelcome to <b>rentpurg3</b> \nA kora node provider rent claiming and monitor demo bot ⚡️\nThis bot allows node providers to monitor available claimable rents from thier kora-signer \n\n\n👉🏻 <b>Start To Use</b>:\n- Import your kora operator signer wallet or just impute the wallet to view available claimable rents.\n\n🚨 Note: 🚨\nNote that the kora nope operator method for creating ATA accounts does not offer setting close account authority for any ATA account created for now, the owner of the account HAS THE AUTHORITY to close and claim the account.but for the sake of this projects will be just working with alerting operators of possible claimable rents and totals sponsored rents by thier nodes.`,

    keyboard: [
      [
        {
          text: ' 🔎 scan the demo gasless bot Kora provider',
          callback_data: JSON.stringify({
            command: '/scanDefault',
            language: 'english',
          }),
        },
      ],
      [
        {
          text: ' 🔎 scan the your Kora provider wallet',
          callback_data: JSON.stringify({
            command: '/scanImported',
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
