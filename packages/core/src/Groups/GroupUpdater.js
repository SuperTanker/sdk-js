// @flow
import { tcrypto, utils } from '@tanker/crypto';

import GroupStore from './GroupStore';
import Keystore from '../Session/Keystore';
import { type ProvisionalIdentityKeyPairs, type ProvisionalIdentityKeyPairsWithId } from '../Session/KeySafe';

import { type VerifiedUserGroup } from '../UnverifiedStore/UserGroupsUnverifiedStore';
import {
  type GroupEncryptedKey,
  type PendingGroupV2EncryptedKey,
  type UserGroupCreationRecord,
  type UserGroupAdditionRecord,
} from '../Blocks/payloads';
import { NATURE_KIND, natureKind } from '../Blocks/Nature';

function findMyUserKeys(groupKeys: $ReadOnlyArray<GroupEncryptedKey>, keystore: Keystore): ?Object {
  for (const gek of groupKeys) {
    const correspondingPair = keystore.findUserKey(gek.public_user_encryption_key);
    if (correspondingPair)
      return {
        userKeyPair: correspondingPair,
        groupEncryptedKey: gek.encrypted_group_private_encryption_key,
      };
  }
  return null;
}

function findMyProvisionalKeys(groupKeys: $ReadOnlyArray<PendingGroupV2EncryptedKey>, keystore: Keystore): ?Object {
  for (const gek of groupKeys) {
    const id = utils.toBase64(utils.concatArrays(gek.pending_app_public_signature_key, gek.pending_tanker_public_signature_key));
    const correspondingPair = keystore.findProvisionalKey(id);
    if (correspondingPair)
      return {
        provisionalKeyPair: correspondingPair,
        groupEncryptedKey: gek.encrypted_group_private_encryption_key,
      };
  }
  return null;
}

function provisionalUnseal(ciphertext: Uint8Array, keys: ProvisionalIdentityKeyPairs): Uint8Array {
  const intermediate = tcrypto.sealDecrypt(ciphertext, keys.tankerEncryptionKeyPair);
  return tcrypto.sealDecrypt(intermediate, keys.appEncryptionKeyPair);
}

export default class GroupUpdater {
  _groupStore: GroupStore;
  _keystore: Keystore;

  constructor(groupStore: GroupStore, keystore: Keystore) {
    this._groupStore = groupStore;
    this._keystore = keystore;
  }

  _applyUserGroupCreation = async (entry: VerifiedUserGroup) => {
    const userGroupCreation: UserGroupCreationRecord = (entry: any);
    let groupPrivateEncryptionKey;

    const userKeys = findMyUserKeys(userGroupCreation.encrypted_group_private_encryption_keys_for_users, this._keystore);
    if (userKeys) {
      groupPrivateEncryptionKey = tcrypto.sealDecrypt(userKeys.groupEncryptedKey, userKeys.userKeyPair);
    } else if (userGroupCreation.pending_encrypted_group_private_encryption_keys_for_users) {
      const provisionalKeys = findMyProvisionalKeys(userGroupCreation.pending_encrypted_group_private_encryption_keys_for_users, this._keystore);
      if (provisionalKeys)
        groupPrivateEncryptionKey = provisionalUnseal(provisionalKeys.groupEncryptedKey, provisionalKeys.provisionalKeyPair);
    }

    if (groupPrivateEncryptionKey) {
      const groupPrivateSignatureKey = tcrypto.sealDecrypt(userGroupCreation.encrypted_group_private_signature_key, { publicKey: userGroupCreation.public_encryption_key, privateKey: groupPrivateEncryptionKey });
      await this._groupStore.put({
        groupId: userGroupCreation.public_signature_key,
        signatureKeyPair: {
          publicKey: userGroupCreation.public_signature_key,
          privateKey: groupPrivateSignatureKey,
        },
        encryptionKeyPair: {
          publicKey: userGroupCreation.public_encryption_key,
          privateKey: groupPrivateEncryptionKey,
        },
        lastGroupBlock: entry.hash,
        index: entry.index,
      });
    } else {
      await this._groupStore.putExternal({
        groupId: userGroupCreation.public_signature_key,
        publicSignatureKey: userGroupCreation.public_signature_key,
        publicEncryptionKey: userGroupCreation.public_encryption_key,
        encryptedPrivateSignatureKey: userGroupCreation.encrypted_group_private_signature_key,
        pendingEncryptionKeys: (userGroupCreation.pending_encrypted_group_private_encryption_keys_for_users || []).map(p => ({
          appPublicSignatureKey: p.pending_app_public_signature_key,
          tankerPublicSignatureKey: p.pending_tanker_public_signature_key,
          encryptedGroupPrivateEncryptionKey: p.encrypted_group_private_encryption_key,
        })),
        lastGroupBlock: entry.hash,
        index: entry.index,
      });
    }
  }

  _applyUserGroupAddition = async (entry: VerifiedUserGroup) => {
    const userGroupAddition: UserGroupAdditionRecord = (entry: any);
    let groupPrivateEncryptionKey;

    const previousGroup = await this._groupStore.findExternal({ groupId: userGroupAddition.group_id });
    if (!previousGroup)
      throw new Error(`Assertion error: can't find group ${utils.toBase64(userGroupAddition.group_id)}`);

    await this._groupStore.updateLastGroupBlock({ groupId: userGroupAddition.group_id, currentLastGroupBlock: entry.hash, currentLastGroupIndex: entry.index });

    const userKeys = findMyUserKeys(userGroupAddition.encrypted_group_private_encryption_keys_for_users, this._keystore);
    if (userKeys) {
      groupPrivateEncryptionKey = tcrypto.sealDecrypt(userKeys.groupEncryptedKey, userKeys.userKeyPair);
    } else if (userGroupAddition.pending_encrypted_group_private_encryption_keys_for_users) {
      const provisionalKeys = findMyProvisionalKeys(userGroupAddition.pending_encrypted_group_private_encryption_keys_for_users, this._keystore);
      if (provisionalKeys)
        groupPrivateEncryptionKey = provisionalUnseal(provisionalKeys.groupEncryptedKey, provisionalKeys.provisionalKeyPair);
    }

    // I am already member of this group, ignore
    if (!previousGroup.encryptedPrivateSignatureKey)
      return;

    if (!groupPrivateEncryptionKey) {
      await this._groupStore.updatePendingEncryptionKeys({
        groupId: previousGroup.groupId,
        pendingEncryptionKeys: (userGroupAddition.pending_encrypted_group_private_encryption_keys_for_users || []).map(p => ({
          appPublicSignatureKey: p.pending_app_public_signature_key,
          tankerPublicSignatureKey: p.pending_tanker_public_signature_key,
          encryptedGroupPrivateEncryptionKey: p.encrypted_group_private_encryption_key,
        })),
      });
      return;
    }

    // I've just been added to this group, lets keep the private keys
    const groupPrivateSignatureKey = tcrypto.sealDecrypt(previousGroup.encryptedPrivateSignatureKey, { publicKey: previousGroup.publicEncryptionKey, privateKey: groupPrivateEncryptionKey });
    await this._groupStore.put({
      groupId: previousGroup.groupId,
      signatureKeyPair: {
        publicKey: previousGroup.publicSignatureKey,
        privateKey: groupPrivateSignatureKey,
      },
      encryptionKeyPair: {
        publicKey: previousGroup.publicEncryptionKey,
        privateKey: groupPrivateEncryptionKey,
      },
      lastGroupBlock: entry.hash,
      index: entry.index,
    });
  }

  applyEntry = async (entry: VerifiedUserGroup) => {
    if (natureKind(entry.nature) === NATURE_KIND.user_group_creation)
      await this._applyUserGroupCreation(entry);
    else if (natureKind(entry.nature) === NATURE_KIND.user_group_addition)
      await this._applyUserGroupAddition(entry);
    else
      throw new Error(`unsupported group update block nature: ${entry.nature}`);
  }

  applyProvisionalIdentityClaim = async (provisionalIdentity: ProvisionalIdentityKeyPairsWithId) => {
    const provisionalGroups = await this._groupStore.findExternalsByPendingId({ id: provisionalIdentity.id });

    const groups = provisionalGroups.map(g => {
      const myKeys = g.pendingEncryptionKeys.filter(pendingKey => {
        const pendingKeyId = utils.toBase64(utils.concatArrays(pendingKey.appPublicSignatureKey, pendingKey.tankerPublicSignatureKey));
        return pendingKeyId === provisionalIdentity.id;
      });
      if (myKeys.length !== 1)
        throw new Error('assertion error: findExternals returned groups without my keys');
      return {
        privateEncryptionKey: provisionalUnseal(myKeys[0].encryptedGroupPrivateEncryptionKey, provisionalIdentity),
        ...g,
      };
    }).map(g => ({
      groupId: g.groupId,
      signatureKeyPair: {
        publicKey: g.publicSignatureKey,
        privateKey: tcrypto.sealDecrypt(g.encryptedPrivateSignatureKey, { publicKey: g.publicEncryptionKey, privateKey: g.privateEncryptionKey }),
      },
      encryptionKeyPair: {
        publicKey: g.publicEncryptionKey,
        privateKey: g.privateEncryptionKey,
      },
      lastGroupBlock: g.lastGroupBlock,
      index: g.index,
    }));

    await this._groupStore.bulkPut(groups);
  }
}
