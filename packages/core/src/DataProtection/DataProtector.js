// @flow

import { tcrypto, utils, type b64string } from '@tanker/crypto';
import { ResourceNotFound, DecryptFailed } from '../errors';
import { ResourceManager, getResourceId } from '../Resource/ResourceManager';
import BlockGenerator from '../Blocks/BlockGenerator';
import { type Block } from '../Blocks/Block';
import { Client } from '../Network/Client';
import { type SessionData } from '../Tokens/SessionTypes';
import GroupManager from '../Groups/Manager';
import UserAccessor from '../Users/UserAccessor';
import { type User, getLastUserPublicKey } from '../Users/UserStore';
import { type ExternalGroup } from '../Groups/types';
import { NATURE_KIND, type NatureKind } from '../Blocks/payloads';
import { decryptData } from './decrypt';
import { encryptData } from './encrypt';
import ChunkEncryptor, { makeChunkEncryptor, type EncryptorInterface } from './ChunkEncryptor';

export type KeyResourceId = {
  key: Uint8Array,
  resourceId: Uint8Array,
};

export type EncryptionOptions = {
  shareWithSelf?: bool,
  shareWith?: Array<string>,
};

export const defaultEncryptionOptions: EncryptionOptions = {
  shareWith: [],
};

export default class DataProtector {
  _resourceManager: ResourceManager;
  _client: Client;

  _groupManager: GroupManager;
  _sessionData: SessionData;
  _userAccessor: UserAccessor;
  _blockGenerator: BlockGenerator;

  constructor(
    resourceManager: ResourceManager,
    client: Client,
    groupManager: GroupManager,
    sessionData: SessionData,
    userAccessor: UserAccessor,
    blockGenerator: BlockGenerator
  ) {
    this._resourceManager = resourceManager;
    this._client = client;
    this._groupManager = groupManager;
    this._sessionData = sessionData;
    this._userAccessor = userAccessor;
    this._blockGenerator = blockGenerator;
  }

  _makeKeyPublishBlocks(
    keyResourceIds: Array<KeyResourceId>,
    keys: Array<Uint8Array>,
    nature: NatureKind
  ): Array<Block> {
    const blocks: Array<Block> = [];
    for (const publicEncryptionKey of keys) {
      for (const { key, resourceId } of keyResourceIds) {
        const sharedKey = tcrypto.sealEncrypt(
          key,
          publicEncryptionKey,
        );

        const payload = {
          recipient: publicEncryptionKey,
          resourceId,
          key: sharedKey,
        };
        const block = this._blockGenerator.makeKeyPublishBlock(payload, nature);

        blocks.push(block);
      }
    }
    return blocks;
  }

  async _publishKeys(
    keyResourceIds: Array<KeyResourceId>,
    recipientUsers: Array<User>,
    recipientGroups: Array<ExternalGroup>
  ): Promise<void> {
    let blocks: Array<Block> = [];
    if (recipientGroups.length > 0) {
      const keys = recipientGroups.map(group => group.publicEncryptionKey);

      blocks = blocks.concat(this._makeKeyPublishBlocks(keyResourceIds, keys, NATURE_KIND.key_publish_to_user_group));
    }

    if (recipientUsers.length > 0) {
      const keys = recipientUsers.map(user => {
        const userPublicKey = getLastUserPublicKey(user);
        if (!userPublicKey)
          throw new Error('Trying to share to a user without user public key');
        return userPublicKey;
      });

      blocks = blocks.concat(this._makeKeyPublishBlocks(keyResourceIds, keys, NATURE_KIND.key_publish_to_user));
    }

    await this._client.sendKeyPublishBlocks(blocks);
  }

  async _separateGroupsFromUsers(shareWith: Array<string>, shareWithSelf: bool): Object {
    const maybeGroupIds = shareWith.map(utils.fromBase64).filter(id => id.length === tcrypto.SIGNATURE_PUBLIC_KEY_SIZE);

    const groups = await this._groupManager.findGroups(maybeGroupIds);
    const groupIds = groups.map(group => group.groupId);

    let doWeReallyShareToSelf = shareWithSelf;
    const userIds = [];
    for (const id of shareWith) {
      const rawId = utils.fromBase64(id);
      // skip groups
      if (groupIds.some(g => utils.equalArray(g, rawId)))
        continue;
      // skip self
      if (id === this._sessionData.userId) {
        doWeReallyShareToSelf = true;
        continue;
      }
      userIds.push(id);
    }
    if (doWeReallyShareToSelf) {
      userIds.push(this._sessionData.clearUserId);
    }

    const users = await this._userAccessor.getUsers({ userIds });

    return {
      users,
      groups,
    };
  }

  async _shareResources(keys: Array<{ resourceId: Uint8Array, key: Uint8Array }>, shareWith: Array<string>, shareWithSelf: bool): Promise<void> {
    const { users, groups } = await this._separateGroupsFromUsers(shareWith, shareWithSelf);

    if (shareWithSelf) {
      const [{ resourceId, key }] = keys;
      await this._resourceManager.saveResourceKey(resourceId, key);
    }

    return this._publishKeys(keys, users, groups);
  }

  async decryptData(protectedData: Uint8Array): Promise<Uint8Array> {
    const resourceId = getResourceId(protectedData);
    const key = await this._resourceManager.findKeyFromResourceId(resourceId, true);
    try {
      return await decryptData(key, protectedData);
    } catch (e) {
      throw new DecryptFailed(e, resourceId);
    }
  }

  async encryptAndShareData(data: Uint8Array, options?: EncryptionOptions): Promise<Uint8Array> {
    const { key, resourceId, encryptedData } = await encryptData(data);

    const opts = { ...defaultEncryptionOptions, ...options };

    await this._shareResources([{ resourceId, key }], opts.shareWith, opts.shareWithSelf);
    return encryptedData;
  }

  async share(resourceIds: Array<b64string>, shareWith: Array<string>): Promise<void> {
    // nothing to return, just wait for the promises to finish
    const keys = await Promise.all(resourceIds.map(async (b64ResourceId) => {
      const resourceId = utils.fromBase64(b64ResourceId);
      const key = await this._resourceManager.findKeyFromResourceId(resourceId);
      if (!key)
        throw new ResourceNotFound(resourceId);
      return { resourceId, key };
    }));

    return this._shareResources(keys, shareWith, false);
  }

  async makeChunkEncryptor(seal?: Uint8Array): Promise<ChunkEncryptor> {
    const encryptor: EncryptorInterface = {
      encryptData: (data, options) => this.encryptAndShareData(data, options),
      decryptData: (encryptedData) => this.decryptData(encryptedData)
    };
    return makeChunkEncryptor(encryptor, seal);
  }
}