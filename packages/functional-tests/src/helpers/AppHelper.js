// @flow
import type { b64string } from '@tanker/core';
import { hashBlock } from '@tanker/core/src/Blocks/Block';
import { NATURE_KIND, preferredNature } from '@tanker/core/src/Blocks/Nature';
import { serializeBlock } from '@tanker/core/src/Blocks/payloads';
import { tcrypto, utils } from '@tanker/crypto';
import { createIdentity } from '@tanker/identity';
import { uuid } from '@tanker/test-utils';

import { AuthenticatedRequester } from './AuthenticatedRequester';
import { oidcSettings, storageSettings } from './config';

function makeRootBlock(appKeyPair: Object) {
  const rootBlock = {
    trustchain_id: new Uint8Array(0),
    nature: preferredNature(NATURE_KIND.trustchain_creation),
    author: new Uint8Array(32),
    payload: appKeyPair.publicKey,
    signature: new Uint8Array(tcrypto.SIGNATURE_SIZE)
  };

  rootBlock.trustchain_id = hashBlock(rootBlock);

  return rootBlock;
}

export class AppHelper {
  _requester: AuthenticatedRequester;
  appId: Uint8Array;
  appKeyPair: Object;
  authToken: string;

  constructor(requester: AuthenticatedRequester, appId: Uint8Array, appKeyPair: Object, authToken: string) {
    this._requester = requester;
    this.appId = appId;
    this.appKeyPair = appKeyPair;
    this.authToken = authToken;
  }

  static async newApp(): Promise<AppHelper> {
    const appKeyPair = tcrypto.makeSignKeyPair();
    const rootBlock = makeRootBlock(appKeyPair);
    const message = {
      root_block: utils.toBase64(serializeBlock(rootBlock)),
      name: `functest-${uuid.v4()}`,
      is_test: true,
      private_signature_key: utils.toBase64(appKeyPair.privateKey),
    };
    const requester = await AuthenticatedRequester.open();
    const createResponse = await requester.send('create trustchain', message);
    const authToken = createResponse.auth_token;
    const appId = rootBlock.trustchain_id;
    return new AppHelper(requester, appId, appKeyPair, authToken);
  }

  async setOIDC() {
    await this._requester.send('update trustchain', {
      id: utils.toBase64(this.appId),
      oidc_provider: 'google',
      oidc_client_id: oidcSettings.googleAuth.clientId,
    });
  }

  async unsetOIDC() {
    await this._requester.send('update trustchain', {
      id: utils.toBase64(this.appId),
      oidc_provider: 'none',
    });
  }

  async setS3() {
    await this._requester.send('update trustchain', {
      id: utils.toBase64(this.appId),
      storage_provider: 's3',
      storage_bucket_name: storageSettings.s3.bucketName,
      storage_bucket_region: storageSettings.s3.bucketRegion,
      storage_client_id: storageSettings.s3.clientId,
      storage_client_secret: storageSettings.s3.clientSecret,
    });
  }

  async unsetS3() {
    await this._requester.send('update trustchain', {
      id: utils.toBase64(this.appId),
      storage_provider: 'none',
    });
  }

  generateIdentity(userId?: string): Promise<b64string> {
    const id = userId || uuid.v4();
    return createIdentity(utils.toBase64(this.appId), utils.toBase64(this.appKeyPair.privateKey), id);
  }

  async getVerificationCode(email: string): Promise<string> {
    const msg = {
      trustchain_id: utils.toBase64(this.appId),
      email,
    };
    const answer = await this._requester.send('get verification code', msg);
    if (!answer.verification_code) {
      throw new Error('Invalid response');
    }
    return answer.verification_code;
  }

  async getWrongVerificationCode(email: string): Promise<string> {
    const code: string = await this.getVerificationCode(email);
    const digits: Array<string> = code.split('');
    const wrongDigitIndex = Math.floor(Math.random() * digits.length);
    const wrongDigit = (parseInt(code[wrongDigitIndex], 10) + 1) % 10;
    digits[wrongDigitIndex] = `${wrongDigit}`;
    return digits.join();
  }

  async cleanup(): Promise<void> {
    await this._requester.send('delete trustchain', { id: utils.toBase64(this.appId) });
  }
}
