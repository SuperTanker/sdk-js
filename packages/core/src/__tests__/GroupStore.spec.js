// @flow

import { expect } from '@tanker/chai';
import { tcrypto } from '@tanker/crypto';
import { mergeSchemas } from '@tanker/datastore-base';

import GroupStore from '../Groups/GroupStore';
import { type Group, type ExternalGroup } from '../Groups/types';

import dataStoreConfig, { makePrefix, openDataStore } from './dataStoreConfig';
import { makeBuffer } from './utils';

async function makeMemoryGroupStore(): Promise<GroupStore> {
  const schemas = mergeSchemas(GroupStore.schemas);

  const baseConfig = { ...dataStoreConfig, schemas };
  const config = { ...baseConfig, dbName: `group-store-test-${makePrefix()}` };
  return GroupStore.open(await openDataStore(config));
}

function makeFullGroup(): Group {
  return {
    groupId: makeBuffer('group id', tcrypto.SIGNATURE_PUBLIC_KEY_SIZE),
    signatureKeyPair: {
      publicKey: makeBuffer('pub sig key', tcrypto.SIGNATURE_PUBLIC_KEY_SIZE),
      privateKey: makeBuffer('priv sig key', tcrypto.SIGNATURE_PRIVATE_KEY_SIZE),
    },
    encryptionKeyPair: {
      publicKey: makeBuffer('pub enc key', tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE),
      privateKey: makeBuffer('priv enc key', tcrypto.ENCRYPTION_PRIVATE_KEY_SIZE),
    },
    lastGroupBlock: makeBuffer('last group block', tcrypto.HASH_SIZE),
    index: 18,
  };
}

function groupToExternalGroup(group: Group): ExternalGroup {
  return {
    groupId: group.groupId,
    publicSignatureKey: group.signatureKeyPair.publicKey,
    publicEncryptionKey: group.encryptionKeyPair.publicKey,
    // just for tests, use the unencrypted private key
    encryptedPrivateSignatureKey: group.signatureKeyPair.privateKey,
    lastGroupBlock: group.lastGroupBlock,
    index: group.index,
  };
}

function makeExternalGroup(): ExternalGroup {
  return groupToExternalGroup(makeFullGroup());
}

describe('GroupStore', () => {
  let groupStore;

  beforeEach(async () => {
    groupStore = await makeMemoryGroupStore();
  });

  it('can add a full group', async () => {
    const group = makeFullGroup();
    await groupStore.put(group);

    const got = await groupStore.findFull({ groupId: group.groupId });
    expect(got).to.deep.equal(group);
  });

  it('can add a full group and get an external group', async () => {
    const group = makeFullGroup();
    await groupStore.put(group);

    const got = await groupStore.findExternal({ groupId: group.groupId });
    const expected = groupToExternalGroup(group);
    expected.encryptedPrivateSignatureKey = null;
    expect(got).to.deep.equal(expected);
  });

  it('can add an external group', async () => {
    const externalGroup = makeExternalGroup();

    await groupStore.putExternal(externalGroup);
    const got = await groupStore.findExternal({ groupId: externalGroup.groupId });
    expect(got).to.deep.equal(externalGroup);
  });

  it('cannot find a group that was not added', async () => {
    expect(await groupStore.findFull({ groupId: new Uint8Array(10) })).to.equal(null);
    expect(await groupStore.findExternal({ groupId: new Uint8Array(10) })).to.equal(null);
  });

  it('cannot find a full group if we only have an external group', async () => {
    const externalGroup = makeExternalGroup();

    await groupStore.putExternal(externalGroup);
    const got = await groupStore.findFull({ groupId: externalGroup.groupId });
    expect(got).to.equal(null);
  });

  it('can find a group by public encryption key', async () => {
    const group = makeFullGroup();
    await groupStore.put(group);

    const got = await groupStore.findFull({ groupPublicEncryptionKey: group.encryptionKeyPair.publicKey });
    expect(got).to.deep.equal(group);
  });

  it('cannot find an external group by public encryption key', async () => {
    const group = makeExternalGroup();
    await groupStore.putExternal(group);

    const got = await groupStore.findFull({ groupPublicEncryptionKey: group.publicEncryptionKey });
    expect(got).to.deep.equal(null);
  });

  it('can extend a group from external to normal', async () => {
    const group = makeFullGroup();
    const externalGroup = groupToExternalGroup(group);

    await groupStore.putExternal(externalGroup);
    await groupStore.put(group);

    const got = await groupStore.findFull({ groupId: externalGroup.groupId });
    expect(got).to.deep.equal(group);
  });

  it('can override groups', async () => {
    const group = makeFullGroup();
    const group2 = makeFullGroup();
    group2.signatureKeyPair.publicKey[0] += 1;
    group2.signatureKeyPair.privateKey[0] += 1;
    group2.encryptionKeyPair.publicKey[0] += 1;
    group2.encryptionKeyPair.privateKey[0] += 1;

    await groupStore.put(group);
    await groupStore.put(group2);

    const got = await groupStore.findFull({ groupId: group.groupId });
    expect(got).to.deep.equal(group2);
  });

  it('can update the last group block of an external group', async () => {
    const group = makeExternalGroup();
    await groupStore.putExternal(group);

    const newBlockHash = makeBuffer('new hash', tcrypto.HASH_SIZE);
    await groupStore.updateLastGroupBlock({ groupId: group.groupId, currentLastGroupBlock: newBlockHash });

    const got = await groupStore.findExternal({ groupId: group.groupId });
    expect(got.lastGroupBlock).to.deep.equal(newBlockHash);
  });

  it('can update the last group block of a full group', async () => {
    const group = makeFullGroup();
    await groupStore.put(group);

    const newBlockHash = makeBuffer('new hash', tcrypto.HASH_SIZE);
    await groupStore.updateLastGroupBlock({ groupId: group.groupId, currentLastGroupBlock: newBlockHash });

    const got = await groupStore.findFull({ groupId: group.groupId });
    expect(got.lastGroupBlock).to.deep.equal(newBlockHash);
  });
});
