// @noflow
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
  const babelConfig = getBabelConfig(env);
  const babelConfigForceUMD = getBabelConfig({ ...env, modules: 'umd' });

  return [
    {
      test: /\.js$/,
      loader: 'babel-loader',
      options: babelConfig,
      exclude: /node_modules/,
    },
    {
      test: /\.js$/,
      loader: 'babel-loader',
      options: babelConfig,
      include: [
        // babelify our own stuff
        /node_modules(\\|\/)@tanker/,
        // babelify all es libs when included (except core-js-pure ponyfills)
        /node_modules(\\|\/)((?!core-js-pure).).*(\\|\/)es(\\|\/)/,
        // ws lib is es6 (it assumes the users will run it in nodejs directly)
        /node_modules(\\|\/)ws/,
        // supports-color is es6
        /node_modules(\\|\/)supports-color/,
        // they use arrow functions and probably more
        /node_modules(\\|\/)query-string/,
      ],
    },
    {
      test: /\.js$/,
      loader: 'babel-loader',
      options: babelConfigForceUMD,
      include: [
        // they use arrow functions
        /node_modules(\\|\/)chai-as-promised/,
        // they use arrow functions
        /node_modules(\\|\/)chai-exclude/,
      ],
    },
  ];
};

const makeBaseConfig = ({ mode, target, react, hmre, devtool, plugins }) => {
  const base = {
    target,
    mode,
    devtool: devtool || (mode === 'development' ? 'source-map' : false),

    context: path.resolve(__dirname, '..'),

    output: {
      filename: mode === 'development' ? 'bundle.js' : 'bundle-[chunkhash].js',
      publicPath: '/',
    },

    module: {
      rules: [
        ...getBabelLoaders({ target, react, hmre }),
        {
          test: /\.(eot|ttf|woff|woff2|svg|png|jpg)$/,
          loader: 'url-loader',
          options: { limit: 25000 },
        },
      ],
    },

    plugins: [
      // Always expose NODE_ENV to webpack, in order to use `process.env.NODE_ENV`
      // inside your code for any environment checks; UglifyJS will automatically
      // drop any unreachable code.
      new webpack.DefinePlugin({
        'process.env': {
          NODE_ENV: JSON.stringify(mode),
        },
        __DEVELOPMENT__: mode === 'development',
        __PRODUCTION__: mode === 'production',
      }),

      ...(plugins || []),
    ],

    node: undefined,
    devServer: undefined,
  };

  if (target === 'web')
    base.node = hackAroundSodium;

  return base;
};

module.exports = { makeBaseConfig };
