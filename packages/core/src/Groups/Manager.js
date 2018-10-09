// @flow

import { tcrypto, utils, type b64string } from '@tanker/crypto';

import UserAccessor from '../Users/UserAccessor';
import BlockGenerator from '../Blocks/BlockGenerator';
import { Client } from '../Network/Client';
import GroupStore from '../Groups/GroupStore';
import { type ExternalGroup } from '../Groups/types';
import Trustchain from '../Trustchain/Trustchain';
import { InvalidArgument, InvalidGroupSize, ServerError } from '../errors';

const MAX_GROUP_SIZE = 1000;

export default class GroupManager {
  _trustchainId: Uint8Array;
  _trustchain: Trustchain;
  _groupStore: GroupStore;
  _userAccessor: UserAccessor;
  _blockGenerator: BlockGenerator;
  _client: Client;

  constructor(
    trustchainId: Uint8Array,
    trustchain: Trustchain,
    groupStore: GroupStore,
    userAccessor: UserAccessor,
    blockGenerator: BlockGenerator,
    client: Client
  ) {
    this._trustchainId = trustchainId;
    this._trustchain = trustchain;
    this._groupStore = groupStore;
    this._userAccessor = userAccessor;
    this._blockGenerator = blockGenerator;
    this._client = client;
  }

  async createGroup(userIds: Array<string>): Promise<b64string> {
    if (userIds.length === 0)
      throw new InvalidGroupSize('A group cannot be created empty');
    if (userIds.length > MAX_GROUP_SIZE)
      throw new InvalidGroupSize(`A group cannot have more than ${MAX_GROUP_SIZE} members`);

    const fullUsers = await this._userAccessor.getUsers({ userIds });

    const groupSignatureKeyPair = tcrypto.makeSignKeyPair();

    // no need to keep the keys, we will get them when we receive the group block
    const userGroupCreationBlock = this._blockGenerator.createUserGroup(
      groupSignatureKeyPair,
      tcrypto.makeEncryptionKeyPair(),
      fullUsers
    );
    await this._client.sendBlock(userGroupCreationBlock);

    return utils.toBase64(groupSignatureKeyPair.publicKey);
  }

  async updateGroupMembers(groupId: string, userIdsToAdd: Array<string>): Promise<void> {
    if (userIdsToAdd.length === 0)
      throw new InvalidGroupSize(`Cannot add no member to group ${groupId}`);
    if (userIdsToAdd.length > MAX_GROUP_SIZE)
      throw new InvalidGroupSize(`Cannot add more than ${MAX_GROUP_SIZE} members to ${groupId}`);

    const fullUsers = await this._userAccessor.getUsers({ userIds: userIdsToAdd });

    const internalGroupId = utils.fromBase64(groupId);
    await this._trustchain.updateGroupStore([internalGroupId]);
    const existingGroup = await this._groupStore.findFull({ groupId: internalGroupId });

    if (!existingGroup) {
      throw new InvalidArgument('groupId', 'string', groupId);
    }

    // no need to keep the keys, we will get them when we receive the group block
    const userGroupCreationBlock = this._blockGenerator.addToUserGroup(
      internalGroupId,
      existingGroup.signatureKeyPair.privateKey,
      existingGroup.lastGroupBlock,
      existingGroup.encryptionKeyPair.privateKey,
      fullUsers
    );
    try {
      await this._client.sendBlock(userGroupCreationBlock);
    } catch (e) {
      if ((e instanceof ServerError) && e.error.code === 'group_too_big')
        throw new InvalidGroupSize(`A group cannot contain more than ${MAX_GROUP_SIZE} members`);
      else
        throw e;
    }
  }

  async hasGroup(groupId: Uint8Array) {
    return this._groupStore.findExternal({ groupId });
  }

  async _fetchGroups(groupIds: Array<Uint8Array>) {
    await this._trustchain.forceSync([], groupIds);
    await this._trustchain.updateGroupStore(groupIds);
  }

  async findGroups(groupIds: Array<Uint8Array>): Promise<Array<ExternalGroup>> {
    const groups: Array<ExternalGroup> = [];
    const externalGroups: Array<Uint8Array> = [];
    for (const groupId of groupIds) {
      const group = await this._groupStore.findFull({ groupId });
      if (group) {
        groups.push({
          groupId: group.groupId,
          publicSignatureKey: group.signatureKeyPair.publicKey,
          publicEncryptionKey: group.encryptionKeyPair.publicKey,
          encryptedPrivateSignatureKey: null,
          lastGroupBlock: group.lastGroupBlock,
          index: group.index,
        });
      } else {
        externalGroups.push(groupId);
      }
    }

    if (externalGroups.length)
      await this._fetchGroups(externalGroups);
    for (const groupId of externalGroups) {
      const group = await this._groupStore.findExternal({ groupId });
      if (group)
        groups.push(group);
    }

    return groups;
  }
}
