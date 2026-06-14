const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  buffer: require.resolve('buffer/'),
};

const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

config.resolver.blockList = [
  new RegExp('^' + escapeRegExp(path.resolve(__dirname, 'android')) + '[/\\\\].*'),
  new RegExp('^' + escapeRegExp(path.resolve(__dirname, 'ios')) + '[/\\\\].*'),
].concat(config.resolver.blockList || []);

module.exports = config;
