// @flow
import uuid from 'uuid';
import Socket from 'socket.io-client';

import type { TankerInterface } from '@tanker/core';
import { hashBlock, type Block } from '@tanker/core/src/Blocks/Block';
import { NATURE_KIND, preferredNature } from '@tanker/core/src/Blocks/Nature';
import { serializeBlock } from '@tanker/core/src/Blocks/payloads';

import { createUserTokenFromSecret } from '@tanker/core/src/__tests__/TestSessionTokens';
import { tcrypto, utils, createUserSecretB64, obfuscateUserId, type b64string } from '@tanker/crypto';

const tankerUrl = process.env.TANKER_URL || '';
const idToken = process.env.TANKER_TOKEN || '';

export { tankerUrl, idToken };

const socket = new Socket(tankerUrl, { transports: ['websocket', 'polling'] });

async function sendMessage(eventName: string, message: Object | string) {
  const jdata = eventName !== 'push block' ? JSON.stringify(message) : message;
  return new Promise((resolve, reject) => {
    socket.emit(
      eventName, jdata,
      jresult => {
        try {
          const result = JSON.parse(jresult);
          if (result && result.error) {
            reject(new Error(JSON.stringify(result.error)));
          } else {
            resolve(result);
          }
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

export function forgeUserToken(userId: string, trustchainId: Uint8Array, trustchainPrivateKey: Uint8Array): b64string {
  const hashedUserId = obfuscateUserId(trustchainId, userId);
  const userSecret = createUserSecretB64(utils.toBase64(trustchainId), userId);
  const token = createUserTokenFromSecret(hashedUserId, trustchainPrivateKey, userSecret);
  return token;
}

export async function syncTankers(...tankers: Array<TankerInterface>): Promise<void> {
  await Promise.all(tankers.map(t => t._session._trustchain && t._session._trustchain.ready())); // eslint-disable-line no-underscore-dangle
}

export const makePrefix = (length: number = 12) => uuid.v4().replace('-', '').slice(0, length);

export function makeRootBlock(trustchainKeyPair: Object) {
  const rootBlock: Block = {
    index: 1,
    trustchain_id: new Uint8Array(0),
    nature: preferredNature(NATURE_KIND.trustchain_creation),
    author: new Uint8Array(32),
    payload: trustchainKeyPair.publicKey,
    signature: new Uint8Array(tcrypto.SIGNATURE_SIZE)
  };

  rootBlock.trustchain_id = hashBlock(rootBlock);

  return rootBlock;
}

export class TrustchainHelper {
  trustchainId: Uint8Array;
  trustchainKeyPair: Object;

  constructor(trustchainId: Uint8Array, trustchainKeyPair: Object) {
    this.trustchainId = trustchainId;
    this.trustchainKeyPair = trustchainKeyPair;
  }

  static async newTrustchain(): Promise<TrustchainHelper> {
    await sendMessage('authenticate customer', { idToken });

    const trustchainKeyPair = tcrypto.makeSignKeyPair();
    const rootBlock = makeRootBlock(trustchainKeyPair);
    const message = {
      root_block: utils.toBase64(serializeBlock(rootBlock)),
      name: `functest-${uuid.v4()}`,
      is_test: true,
    };
    await sendMessage('create trustchain', message);

    const trustchainId = rootBlock.trustchain_id;

    return new TrustchainHelper(trustchainId, trustchainKeyPair);
  }

  generateUserToken(userId: string) {
    return forgeUserToken(userId, this.trustchainId, this.trustchainKeyPair.privateKey);
  }

  async getVerificationCode(userId: string, email: string): Promise<string> {
    const hashedUserId = obfuscateUserId(this.trustchainId, userId);
    const msg = {
      trustchain_id: utils.toBase64(this.trustchainId),
      email,
      user_id: utils.toBase64(hashedUserId),
    };
    const answer = await sendMessage('get verification code', msg);
    if (!answer.verification_code)
      throw new Error('Invalid response');
    return answer.verification_code;
  }

  async cleanup(): Promise<void> {
    await this.deleteRemoteTrustchain();
  }

  async deleteRemoteTrustchain(): Promise<void> {
    await sendMessage('authenticate customer', { idToken });
    return sendMessage('delete trustchain', { id: utils.toBase64(this.trustchainId) });
  }
}
