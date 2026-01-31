export const allFeaturesMarkup = async () => {
  return {
    message: `Please Select any action below 👇\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003 : `,
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
          text: ' 🔎 scan  your Kora provider wallet',
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
