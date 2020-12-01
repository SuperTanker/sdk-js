// @flow
import { utils, type b64string } from '@tanker/crypto';
import { InternalError, InvalidArgument } from '@tanker/errors';
import { type PublicPermanentIdentity } from '@tanker/identity';

import type { Client } from '../Network/Client';
import { type User } from './types';
import LocalUser from '../LocalUser/LocalUser';
import { usersFromBlocks } from './ManagerHelper';

// ensure that the UserStore is always up-to-date before requesting it.
export default class UserManager {
  _client: Client;
  _localUser: LocalUser;

  constructor(client: Client, localUser: LocalUser) {
    this._client = client;
    this._localUser = localUser;
  }

  async findUser(userId: Uint8Array) {
    const blocks = await this._getUserBlocksByUserIds([userId]);
    const { userIdToUserMap } = await usersFromBlocks(blocks, this._localUser.trustchainId, this._localUser.trustchainPublicKey);
    return userIdToUserMap.get(utils.toBase64(userId));
  }

  async getUsers(publicIdentities: Array<PublicPermanentIdentity>): Promise<Array<User>> {
    if (publicIdentities.length === 0) {
      return [];
    }

    const userIds = publicIdentities.map(u => {
      if (u.target !== 'user')
        throw new InternalError(`Assertion error: publicIdentity ${u.target} should be 'user'`);
      return utils.fromBase64(u.value);
    });

    const blocks = await this._getUserBlocksByUserIds(userIds);
    const { userIdToUserMap } = await usersFromBlocks(blocks, this._localUser.trustchainId, this._localUser.trustchainPublicKey);
    const fullUsers = Array.from(userIdToUserMap.values());

    if (fullUsers.length === userIds.length)
      return fullUsers;

    const invalidPublicIdentities = [];
    for (const publicIdentity of publicIdentities) {
      if (!userIdToUserMap.has(publicIdentity.value)) {
        // $FlowIgnore serializedIdentity is a "hidden" property (non enumerable, not declared in types)
        invalidPublicIdentities.push(publicIdentity.serializedIdentity || utils.toB64Json(publicIdentity));
      }
    }

    const message = `The following identities are invalid or do not exist on the trustchain: "${invalidPublicIdentities.join('", "')}"`;
    throw new InvalidArgument(message);
  }

  async getDeviceKeysByDevicesIds(devicesIds: Array<Uint8Array>) {
    const blocks = await this._getUserBlocksByDeviceIds(devicesIds);

    const { userIdToUserMap, deviceIdToUserIdMap } = await usersFromBlocks(blocks, this._localUser.trustchainId, this._localUser.trustchainPublicKey);
    return this._getDeviceKeysFromIds(userIdToUserMap, deviceIdToUserIdMap, devicesIds);
  }

  _getDeviceKeysFromIds(userIdToUserMap: Map<b64string, User>, deviceIdToUserIdMap: Map<b64string, b64string>, devicesIds: Array<Uint8Array>): Map<b64string, Uint8Array> {
    const devicesPublicSignatureKeys: Map<b64string, Uint8Array> = new Map();
    for (const deviceId of devicesIds) {
      const base64DeviceId = utils.toBase64(deviceId);
      const userId = deviceIdToUserIdMap.get(base64DeviceId);
      if (!userId) {
        throw new InternalError('Assertion error: no such author user id');
      }
      const user = userIdToUserMap.get(userId);
      if (!user) {
        throw new InternalError('Assertion error: no such author user');
      }
      const device = user.devices.find(userDevice => utils.equalArray(userDevice.deviceId, deviceId));
      if (!device) {
        throw new InternalError('Assertion error: no such author device');
      }
      devicesPublicSignatureKeys.set(base64DeviceId, device.devicePublicSignatureKey);
    }
    return devicesPublicSignatureKeys;
  }

  _getUserBlocksByUserIds = async (userIds: Array<Uint8Array>): Promise<Array<b64string>> => {
    const { histories } = await this._client.getUserHistoriesByUserIds(userIds);
    return histories;
  }

  _getUserBlocksByDeviceIds = async (deviceIds: Array<Uint8Array>): Promise<Array<b64string>> => {
    const { histories } = await this._client.getUserHistoriesByDeviceIds(deviceIds);
    return histories;
  }
}
