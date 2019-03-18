// @flow
import { tcrypto, utils } from '@tanker/crypto';

import GroupStore from './GroupStore';
import Keystore from '../Session/Keystore';
import { type ProvisionalIdentityKeyPairs } from '../Session/KeySafe';

import { type VerifiedUserGroup } from '../UnverifiedStore/UserGroupsUnverifiedStore';
import {
  type GroupEncryptedKey,
  type PendingGroupV2EncryptedKey,
  type UserGroupCreationRecord,
  type UserGroupAdditionRecordV1,
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
        lastGroupBlock: entry.hash,
        index: entry.index,
      });
    }
  }

  _applyUserGroupAddition = async (entry: VerifiedUserGroup) => {
    const userGroupAddition: UserGroupAdditionRecordV1 = (entry: any);

    const previousGroup = await this._groupStore.findExternal({ groupId: userGroupAddition.group_id });
    if (!previousGroup)
      throw new Error(`Assertion error: can't find group ${utils.toBase64(userGroupAddition.group_id)}`);

    await this._groupStore.updateLastGroupBlock({ groupId: userGroupAddition.group_id, currentLastGroupBlock: entry.hash, currentLastGroupIndex: entry.index });

    const myKeys = findMyUserKeys(userGroupAddition.encrypted_group_private_encryption_keys_for_users, this._keystore);
    if (!myKeys)
      return;
    // I am already member of this group, ignore
    if (!previousGroup.encryptedPrivateSignatureKey)
      return;

    // I've just been added to this group, lets keep the private keys
    const groupPrivateEncryptionKey = tcrypto.sealDecrypt(myKeys.groupEncryptedKey, myKeys.userKeyPair);
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
}
