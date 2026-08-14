const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// expo-sqlite's web worker imports this as a runtime asset.
config.resolver.assetExts.push("wasm");

module.exports = config;
