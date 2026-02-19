const appJson = require("./app.json");

module.exports = ({ config }) => {
  const base = config ?? appJson.expo;
  const androidMapsApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim();
  if (!androidMapsApiKey) {
    throw new Error("Missing GOOGLE_MAPS_ANDROID_API_KEY in build environment.");
  }

  return {
    ...base,
    android: {
      ...base.android,
      config: {
        ...(base.android?.config ?? {}),
        googleMaps: {
          apiKey: androidMapsApiKey,
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
