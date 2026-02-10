const appJson = require("./app.json");

module.exports = ({ config }) => {
  const base = config ?? appJson.expo;

  return {
    ...base,
    android: {
      ...base.android,
      config: {
        ...(base.android?.config ?? {}),
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? "",
        },
      },
    },
    ios: {
      ...base.ios,
      config: {
        ...(base.ios?.config ?? {}),
        googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY ?? "",
      },
    },
  };
};

