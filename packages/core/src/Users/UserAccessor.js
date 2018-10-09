// @flow

import { utils, obfuscateUserId } from '@tanker/crypto';

import UserStore, { type User, type FindUserParameters, type FindUsersParameters } from '../Users/UserStore';
import Trustchain from '../Trustchain/Trustchain';
import { InvalidArgument, RecipientsNotFound } from '../errors';

export type UserDevice = {|
    id: string,
    isGhostDevice: bool,
    isRevoked: bool
|}

// ensure that the UserStore is always up-to-date before requesting it.
export default class UserAccessor {
  _userStore: UserStore;
  _trustchain: Trustchain;
  _trustchainId: Uint8Array;
  _userId: Uint8Array;

  constructor(userStore: UserStore, trustchainAPI: Trustchain, trustchainId: Uint8Array, userId: Uint8Array) {
    this._userStore = userStore;
    this._trustchain = trustchainAPI;
    this._trustchainId = trustchainId;
    this._userId = userId;
  }

  async hasDevice(userId: Uint8Array, deviceId: Uint8Array) {
    return this._userStore.hasDevice(userId, deviceId);
  }

  async _fetchUsers(userIds: Array<Uint8Array>) {
    const userIdsWithoutMe = userIds.filter(u => !utils.equalArray(u, this._userId));
    await this._trustchain.forceSync(userIdsWithoutMe, []);
    await this._trustchain.updateUserStore(userIdsWithoutMe);
  }

  async findUser(args: FindUserParameters): Promise<?User> {
    const { hashedUserId } = args;
    if (!hashedUserId)
      throw new Error('invalid hashedUserId');

    await this._fetchUsers([hashedUserId]);
    const user = await this._userStore.findUser(args);
    return user;
  }

  async findUserDevices({ hashedUserId }: FindUserParameters): Promise<Array<UserDevice>> {
    if (!hashedUserId)
      throw new InvalidArgument('hashedUserId', 'Uint8Array', hashedUserId);
    const user = await this.findUser({ hashedUserId });
    if (!user)
      throw new Error(`no such user ${utils.toString(hashedUserId)}`);
    return user.devices.map(device => ({
      id: device.deviceId,
      isGhostDevice: device.isGhostDevice,
      isRevoked: device.revokedAt !== Number.MAX_SAFE_INTEGER,
    }));
  }

  async findUsers(args: FindUsersParameters): Promise<Array<User>> {
    const { hashedUserIds } = args;
    if (!hashedUserIds)
      throw new Error('invalid hashedUserIds');

    await this._fetchUsers(hashedUserIds);

    const users = await this._userStore.findUsers(args);
    return users;
  }

  async getUsers({ userIds }: {userIds: Array<string>}): Promise<Array<User>> {
    const obfuscatedUserIds = userIds.map(u => obfuscateUserId(this._trustchainId, u));

    const fullUsers = await this.findUsers({ hashedUserIds: obfuscatedUserIds });

    if (fullUsers.length === obfuscatedUserIds.length)
      return fullUsers;

    const missingIds = [];
    for (const [index, obfuscatedId] of obfuscatedUserIds.entries()) {
      const b64ObfuscatedId = utils.toBase64(obfuscatedId);
      const found = fullUsers.some(user => user.userId === b64ObfuscatedId);
      if (!found)
        missingIds.push(userIds[index]);
    }
    throw new RecipientsNotFound(missingIds);
  }

  async getDevicePublicEncryptionKey(deviceId: Uint8Array): Promise<?Uint8Array> {
    const device = await this._userStore.findDevice({ hashedDeviceId: deviceId });
    if (device)
      return device.devicePublicEncryptionKey;

    const newlyVerifiedDevice = await this._trustchain.verifyDevice(deviceId);
    if (newlyVerifiedDevice)
      return newlyVerifiedDevice.public_encryption_key;

    throw new RecipientsNotFound([utils.toBase64(deviceId)]);
  }
}
