// @flow

import { utils, type b64string } from '@tanker/crypto';

export type UserToken = {|
  ephemeral_public_signature_key: b64string,
  ephemeral_private_signature_key: b64string,
  user_id: b64string,
  delegation_signature: b64string,
  user_secret: b64string,
|};

export type UserDelegationToken = {|
  ephemeral_private_signature_key: b64string,
  ephemeral_public_signature_key: b64string,
  user_id: b64string,
  delegation_signature: b64string,
  last_reset: b64string,
|};

export function extractFromUserToken(userToken: UserToken) {
  const { user_secret, ...delegationToken } = userToken; // eslint-disable-line camelcase

  return { userSecret: utils.fromBase64(user_secret), delegationToken };
}
