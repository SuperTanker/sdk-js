// @flow
import { utils, type b64string } from '@tanker/crypto';
import { type PublicIdentity, type PublicProvisionalIdentity, _deserializePublicIdentity } from '@tanker/identity';
import { ResourceNotFound, DecryptFailed } from '../errors';
import { ResourceManager, getResourceId } from '../Resource/ResourceManager';
import { type Block } from '../Blocks/Block';
import { Client } from '../Network/Client';
import LocalUser from '../Session/LocalUser';
import GroupManager from '../Groups/Manager';
import UserAccessor from '../Users/UserAccessor';
import { type User, getLastUserPublicKey } from '../Users/User';
import { type ExternalGroup } from '../Groups/types';
import { NATURE_KIND, type NatureKind } from '../Blocks/Nature';
import { decryptData } from './Encryptor';
import { type EncryptionOptions } from './EncryptionOptions';
import { type ShareWithOptions } from './ShareWithOptions';
import EncryptorStream from './EncryptorStream';
import DecryptorStream from './DecryptorStream';

export type KeyResourceId = {
  key: Uint8Array,
  resourceId: Uint8Array,
};

export type InviteePublicKeys = {
  appSignaturePublicKey: Uint8Array,
  appEncryptionPublicKey: Uint8Array,
  tankerSignaturePublicKey: Uint8Array,
  tankerEncryptionPublicKey: Uint8Array,
};

export default class DataProtector {
  _resourceManager: ResourceManager;
  _client: Client;

  _groupManager: GroupManager;
  _localUser: LocalUser;
  _userAccessor: UserAccessor;

  constructor(
    resourceManager: ResourceManager,
    client: Client,
    groupManager: GroupManager,
    localUser: LocalUser,
    userAccessor: UserAccessor,
  ) {
    this._resourceManager = resourceManager;
    this._client = client;
    this._groupManager = groupManager;
    this._localUser = localUser;
    this._userAccessor = userAccessor;
  }

  _makeKeyPublishBlocks(
    keyResourceIds: Array<KeyResourceId>,
    keys: Array<Uint8Array>,
    nature: NatureKind
  ): Array<Block> {
    const blocks: Array<Block> = [];
    for (const publicEncryptionKey of keys) {
      for (const { key, resourceId } of keyResourceIds) {
        const block = this._localUser.blockGenerator.makeKeyPublishBlock(publicEncryptionKey, key, resourceId, nature);
        blocks.push(block);
      }
    }
    return blocks;
  }

  _makeInviteeKeyPublishBlocks(
    keyResourceIds: Array<KeyResourceId>,
    invitees: Array<InviteePublicKeys>
  ): Array<Block> {
    const blocks: Array<Block> = [];
    for (const invitee of invitees) {
      for (const { key, resourceId } of keyResourceIds) {
        blocks.push(this._localUser.blockGenerator.makeInviteeKeyPublishBlock(invitee, key, resourceId));
      }
    }
    return blocks;
  }

  async _publishKeys(
    keyResourceIds: Array<KeyResourceId>,
    recipientUsers: Array<User>,
    recipientInvitees: Array<PublicProvisionalIdentity>,
    recipientGroups: Array<ExternalGroup>
  ): Promise<void> {
    let blocks: Array<Block> = [];
    if (recipientGroups.length > 0) {
      const keys = recipientGroups.map(group => group.publicEncryptionKey);

      blocks = blocks.concat(this._makeKeyPublishBlocks(keyResourceIds, keys, NATURE_KIND.key_publish_to_user_group));
    }

    if (recipientInvitees.length > 0) {
      const provisionalIds = recipientInvitees.map(e => ({ [e.target]: e.value }));
      const tankerPublicKeys = await this._client.getInviteeKeys(provisionalIds);
      const invitees = tankerPublicKeys.map((e, i) => ({
        ...e,
        appSignaturePublicKey: recipientInvitees[i].publicPreshareSignatureKey,
        appEncryptionPublicKey: recipientInvitees[i].publicPreshareEncryptionKey,
      }));
      blocks = blocks.concat(this._makeInviteeKeyPublishBlocks(keyResourceIds, invitees));
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

  _splitProvisionalAndFullIdentities = (identities: Array<PublicIdentity>): * => {
    const fullUsers: Array<PublicIdentity> = [];
    // $FlowIKnow This checks that the target is correct, so type refinement is fine
    const preUsers: Array<PublicProvisionalIdentity> = identities.filter(elem => {
      const isFull = elem.target === 'user';
      if (isFull)
        fullUsers.push(elem);
      return !isFull;
    });
    return { fullUsers, preUsers };
  }

  _handleShareWithSelf = (identities: Array<b64string>, shareWithSelf: bool): Array<string> => {
    if (shareWithSelf) {
      const selfUserIdentity = utils.toB64Json(this._localUser.publicIdentity);
      if (identities.indexOf(selfUserIdentity) === -1) {
        return identities.concat([selfUserIdentity]);
      }
    }

    return identities;
  }

  async _shareResources(keys: Array<{ resourceId: Uint8Array, key: Uint8Array }>, shareWithOptions: ShareWithOptions, shareWithSelf: bool): Promise<void> {
    const groupIds = (shareWithOptions.shareWithGroups || []).map(g => utils.fromBase64(g));
    const groups = await this._groupManager.findGroups(groupIds);
    const b64UserIdentities = this._handleShareWithSelf(shareWithOptions.shareWithUsers || [], shareWithSelf);
    const deserializedIdentities = b64UserIdentities.map(i => _deserializePublicIdentity(i));
    const { fullUsers, preUsers } = this._splitProvisionalAndFullIdentities(deserializedIdentities);
    const users = await this._userAccessor.getUsers({ publicIdentities: fullUsers });

    if (shareWithSelf) {
      const [{ resourceId, key }] = keys;
      await this._resourceManager.saveResourceKey(resourceId, key);
    }

    return this._publishKeys(keys, users, preUsers, groups);
  }

  async decryptData(protectedData: Uint8Array): Promise<Uint8Array> {
    const resourceId = getResourceId(protectedData);
    const key = await this._resourceManager.findKeyFromResourceId(resourceId, true);
    try {
      return decryptData(key, protectedData);
    } catch (e) {
      throw new DecryptFailed(e, resourceId);
    }
  }

  async encryptAndShareData(data: Uint8Array, options: EncryptionOptions = {}): Promise<Uint8Array> {
    const { key, resourceId, encryptedData } = this._resourceManager.makeSimpleResource(data);
    await this._shareResources([{ resourceId, key }], options, options.shareWithSelf || false);
    return encryptedData;
  }

  async share(resourceIds: Array<b64string>, shareWith: ShareWithOptions): Promise<void> {
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

  async makeEncryptorStream(options: EncryptionOptions): Promise<EncryptorStream> {
    const streamResource = this._resourceManager.makeStreamResource();
    const encryptorStream = new EncryptorStream(streamResource.resourceId, streamResource.key);

    await this._shareResources([streamResource], options, options.shareWithSelf || false);

    return encryptorStream;
  }

  async makeDecryptorStream(): Promise<DecryptorStream> {
    const resourceIdKeyMapper = {
      findKey: (resourceId) => this._resourceManager.findKeyFromResourceId(resourceId, true)
    };
    return new DecryptorStream(resourceIdKeyMapper);
  }
}
