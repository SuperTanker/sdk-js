// @noflow
const webpack = require('webpack');

const karmaConfig = require('./karma.config.base');
const { makeBaseConfig } = require('../webpack.config.base');

module.exports = (config) => {
  config.set({
    ...karmaConfig,

    webpack: makeBaseConfig({
      mode: 'development',
      target: 'web',
      react: true,
      plugins: [
        new webpack.DefinePlugin({
          'process.env': {
            TANKER_TOKEN: JSON.stringify(process.env.TANKER_TOKEN),
            TANKER_URL: JSON.stringify(process.env.TANKER_URL),
            CI: JSON.stringify(process.env.CI),
          },
        }),
      ]
    }),

    // level of logging
    // possible values: config.LOG_DISABLE || config.LOG_ERROR || config.LOG_WARN || config.LOG_INFO || config.LOG_DEBUG
    logLevel: config.LOG_INFO,

    // enable / disable watching file and executing tests whenever any file changes
    autoWatch: true,

    // Continuous Integration mode
    // if true, Karma captures browsers, runs the tests and exits
    singleRun: false,
  });
};
