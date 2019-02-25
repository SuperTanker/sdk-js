// @flow

import { utils } from '@tanker/crypto';

import { generateUnlockKeyRegistration, createUnlockKeyMessage, type UnlockKey, type UnlockKeyMessage } from './unlock';

import { Client } from '../Network/Client';
import LocalUser from '../Session/LocalUser';


export class UnlockKeys {
  _localUser: LocalUser;
  _client: Client;

  constructor(localUser: LocalUser, client: Client) {
    this._localUser = localUser;
    this._client = client;
  }

  _generateUnlockKey = () => generateUnlockKeyRegistration({
    trustchainId: this._localUser.trustchainId,
    userId: this._localUser.userId,
    userKeys: this._localUser.currentUserKey,
    deviceType: this._localUser.deviceType,
    authorDevice: {
      id: this._localUser.deviceId,
      privateSignatureKey: this._localUser.privateSignatureKey,
      privateEncryptionKey: this._localUser.privateEncryptionKey,
    }
  });

  generateAndRegisterUnlockKey = async (): Promise<UnlockKey> => {
    const reg = this._generateUnlockKey();
    await this._client.sendBlock(reg.block);
    return reg.unlockKey;
  }

  _createUnlockKeyMessage = (password: ?string, email: ?string, unlockKey: ?string): Promise<UnlockKeyMessage> => createUnlockKeyMessage({
    trustchainId: utils.toBase64(this._localUser.trustchainId),
    deviceId: utils.toBase64(this._localUser.deviceId),
    email,
    password,
    unlockKey,
    userSecret: this._localUser.userSecret,
    privateSigKey: this._localUser.privateSignatureKey
  });

  _updateLocalUser = (password: ?string, email: ?string): void => {
    if (password && !this._localUser.unlockMethods.some((m) => m.type === 'password')) {
      this._localUser.unlockMethods.push({ type: 'password' });
    }
    if (email && !this._localUser.unlockMethods.some((m) => m.type === 'email')) {
      this._localUser.unlockMethods.push({ type: 'email' });
    }
  }

  registerUnlock = async (password: ?string, email: ?string): Promise<void> => {
    const isFirstRegister = this._localUser.unlockMethods.length === 0;
    let block = null;
    let unlockKey = null;

    if (isFirstRegister) {
      ({ block, unlockKey } = this._generateUnlockKey());
    }

    const msg = await this._createUnlockKeyMessage(password, email, unlockKey);

    if (block) {
      await this._client.sendBlock(block);
      await this._client.createUnlockKey(msg);
    } else {
      await this._client.updateUnlockKey(msg);
    }

    this._updateLocalUser(password, email);
  }
}
