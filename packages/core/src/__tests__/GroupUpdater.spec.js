// @flow

import { expect } from '@tanker/chai';
import { mergeSchemas } from '@tanker/datastore-base';

import { type UserGroupAdditionRecord, type UserGroupCreationRecord } from '../Blocks/payloads';
import GroupStore from '../Groups/GroupStore';
import GroupUpdater from '../Groups/GroupUpdater';
import dataStoreConfig, { makePrefix, openDataStore } from './dataStoreConfig';
import { makeTrustchainBuilder } from './TrustchainBuilder';

async function makeMemoryGroupStore(): Promise<GroupStore> {
  const schemas = mergeSchemas(GroupStore.schemas);

  const baseConfig = { ...dataStoreConfig, schemas };
  const config = { ...baseConfig, dbName: `group-store-test-${makePrefix()}` };
  return GroupStore.open(await openDataStore(config));
}

describe('GroupUpdater', () => {
  it('handles a group creation I do not belong to', async () => {
    const builder = await makeTrustchainBuilder();

    const alice = await builder.addUserV3('alice');
    const bob = await builder.addUserV3('bob');
    const group = await builder.addUserGroupCreation(bob, ['bob']);

    const groupStore = await makeMemoryGroupStore();
    const groupUpdater = new GroupUpdater(groupStore, await builder.getKeystoreOfDevice(alice.user, alice.device));

    const payload: UserGroupCreationRecord = (group.entry.payload_unverified: any);

    await groupUpdater.applyEntry({ ...group.entry, ...payload });

    expect(await groupStore.findExternal({ groupId: group.groupSignatureKeyPair.publicKey })).to.deep.equal({
      groupId: group.groupSignatureKeyPair.publicKey,
      publicSignatureKey: group.groupSignatureKeyPair.publicKey,
      publicEncryptionKey: group.groupEncryptionKeyPair.publicKey,
      encryptedPrivateSignatureKey: payload.encrypted_group_private_signature_key,
      lastGroupBlock: group.entry.hash,
      index: group.entry.index,
    });
    expect(await groupStore.findFull({ groupId: group.groupSignatureKeyPair.publicKey })).to.deep.equal(null);
  });

  it('handles a group creation I do belong to', async () => {
    const builder = await makeTrustchainBuilder();

    const alice = await builder.addUserV3('alice');
    const group = await builder.addUserGroupCreation(alice, ['alice']);
    const payload: UserGroupCreationRecord = (group.entry.payload_unverified: any);

    const groupStore = await makeMemoryGroupStore();
    const groupUpdater = new GroupUpdater(groupStore, await builder.getKeystoreOfDevice(alice.user, alice.device));

    await groupUpdater.applyEntry({ ...group.entry, ...payload });

    expect(await groupStore.findFull({ groupId: group.groupSignatureKeyPair.publicKey })).to.deep.equal({
      groupId: group.groupSignatureKeyPair.publicKey,
      signatureKeyPair: group.groupSignatureKeyPair,
      encryptionKeyPair: group.groupEncryptionKeyPair,
      lastGroupBlock: group.entry.hash,
      index: group.entry.index,
    });
  });

  it('handles a group addition for a group I do not belong to', async () => {
    const builder = await makeTrustchainBuilder();

    const alice = await builder.addUserV3('alice');
    const bob = await builder.addUserV3('bob');
    await builder.addUserV3('charlie');
    const group = await builder.addUserGroupCreation(bob, ['bob']);
    const payload: UserGroupCreationRecord = (group.entry.payload_unverified: any);

    const groupAdd = await builder.addUserGroupAddition(bob, group, ['charlie']);
    const additionPayload: UserGroupAdditionRecord = (groupAdd.entry.payload_unverified: any);

    const groupStore = await makeMemoryGroupStore();
    const groupUpdater = new GroupUpdater(groupStore, await builder.getKeystoreOfDevice(alice.user, alice.device));

    await groupUpdater.applyEntry({ ...group.entry, ...payload });
    await groupUpdater.applyEntry({ ...groupAdd.entry, ...additionPayload });

    const newGroup = await groupStore.findExternal({ groupId: group.groupSignatureKeyPair.publicKey });
    expect(newGroup.lastGroupBlock).to.deep.equal(groupAdd.entry.hash);
  });

  it('handles a group addition I always belonged to', async () => {
    const builder = await makeTrustchainBuilder();

    const alice = await builder.addUserV3('alice');
    await builder.addUserV3('charlie');
    const group = await builder.addUserGroupCreation(alice, ['alice']);
    const payload: UserGroupCreationRecord = (group.entry.payload_unverified: any);

    const groupAdd = await builder.addUserGroupAddition(alice, group, ['charlie']);
    const additionPayload: UserGroupAdditionRecord = (groupAdd.entry.payload_unverified: any);

    const groupStore = await makeMemoryGroupStore();
    const groupUpdater = new GroupUpdater(groupStore, await builder.getKeystoreOfDevice(alice.user, alice.device));

    await groupUpdater.applyEntry({ ...group.entry, ...payload });
    await groupUpdater.applyEntry({ ...groupAdd.entry, ...additionPayload });

    const newGroup = await groupStore.findExternal({ groupId: group.groupSignatureKeyPair.publicKey });
    expect(newGroup.lastGroupBlock).to.deep.equal(groupAdd.entry.hash);
  });

  it('handles a group addition which adds me', async () => {
    const builder = await makeTrustchainBuilder();

    const alice = await builder.addUserV3('alice');
    const charlie = await builder.addUserV3('charlie');

    const group = await builder.addUserGroupCreation(alice, ['alice']);
    const payload: UserGroupCreationRecord = (group.entry.payload_unverified: any);

    const groupAdd = await builder.addUserGroupAddition(alice, group, ['charlie']);
    const additionPayload: UserGroupAdditionRecord = (groupAdd.entry.payload_unverified: any);

    const groupStore = await makeMemoryGroupStore();
    const groupUpdater = new GroupUpdater(groupStore, await builder.getKeystoreOfDevice(charlie.user, charlie.device));

    await groupUpdater.applyEntry({ ...group.entry, ...payload });
    await groupUpdater.applyEntry({ ...groupAdd.entry, ...additionPayload });

    expect(await groupStore.findFull({ groupId: group.groupSignatureKeyPair.publicKey })).to.deep.equal({
      groupId: group.groupSignatureKeyPair.publicKey,
      signatureKeyPair: group.groupSignatureKeyPair,
      encryptionKeyPair: group.groupEncryptionKeyPair,
      lastGroupBlock: groupAdd.entry.hash,
      index: groupAdd.entry.index,
    });
  });
});
