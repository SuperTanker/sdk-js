const path = require('path');
const webpack = require('webpack');

const getBabelConfig = require('./babel.config');

const hackAroundSodium = {
  // libsodium uses fs for some reason, we don't ever want that in a browser
  fs: 'empty',
  // libsodium never actually uses node's crypto in our case
  crypto: 'empty',
};

const getBabelLoaders = (env) => {
  const config = getBabelConfig(env);

  return [
    {
      test: /\.js$/,
      loader: 'babel-loader',
      options: config,
      exclude: /node_modules/,
    },
    {
      test: /\.js$/,
      loader: 'babel-loader',
      options: config,
      include: [
        // babelify our own stuff
        /node_modules(\\|\/)@tanker/,
        // babelify all es libs when included
        /node_modules(\\|\/).*(\\|\/)es(\\|\/)/,
        // ws lib is es6 (it assumes the users will run it in nodejs directly)
        /node_modules(\\|\/)ws/,
      ],
    },
    {
      test: /\.js$/,
      loader: 'babel-loader',
      options: {
        presets: [['@babel/preset-env', {
          modules: 'umd',
          useBuiltIns: 'usage',
          targets: { browsers: ['last 2 versions', 'ie >= 11'] },
        }]],
      },
      include: [
        // they use arrow functions
        /node_modules(\\|\/)chai-as-promised/,
        // they use Promise
        /node_modules(\\|\/)async-mutex/,
      ],
    },
  ];
};

const makeBaseConfig = ({ mode, target }) => {
  const base = {
    target,
    mode,
    devtool: mode === 'development' ? 'source-map' : false,

    context: path.resolve(__dirname, '..'),

    output: {
      filename: mode === 'development' ? 'bundle.js' : 'bundle-[chunkhash].js',
      publicPath: '/',
    },

    module: {
      rules: [
        ...getBabelLoaders({ prod: mode === 'production', target })
      ],
    },

    plugins: [
      // Always expose NODE_ENV to webpack, in order to use `process.env.NODE_ENV`
      // inside your code for any environment checks; UglifyJS will automatically
      // drop any unreachable code.
      new webpack.DefinePlugin({
        'process.env': {
          NODE_ENV: JSON.stringify(mode),
          PROJECT_CONFIG: JSON.stringify(process.env.PROJECT_CONFIG),
        },
        __DEVELOPMENT__: mode === 'development',
        __PRODUCTION__: mode === 'production',
      }),
    ],

    node: undefined,
    devServer: undefined,
  };

  if (target === 'web')
    base.node = hackAroundSodium;

  return base;
};

module.exports = { makeBaseConfig };
