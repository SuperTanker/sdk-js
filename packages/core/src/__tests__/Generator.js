// @flow
import { tcrypto, utils } from '@tanker/crypto';
import { obfuscateUserId } from '@tanker/identity';

import type { UnverifiedEntry } from '../Blocks/entries';

import { SEALED_KEY_SIZE, serializeBlock } from '../Blocks/payloads';
import { type TrustchainCreationEntry, serializeTrustchainCreation, trustchainCreationFromBlock } from '../Session/LocalUser/Serialize';
import type { Device } from '../Users/types';

import { signBlock, hashBlock, type Block } from '../Blocks/Block';


import { serializeUserDeviceV3, type DeviceCreationRecord, type DeviceCreationEntry, deviceCreationFromBlock } from '../Users/Serialize';

import { preferredNature, NATURE, NATURE_KIND, type Nature } from '../Blocks/Nature';

export type GeneratorDevice = {
  id: Uint8Array,
  signKeys: tcrypto.SodiumKeyPair,
  encryptionKeys: tcrypto.SodiumKeyPair,
}

export type GeneratorUser = {
  id: string,
  userKeys?: tcrypto.SodiumKeyPair,
  devices: Array<GeneratorDevice>,
}

export function serializeUserDeviceV1(userDevice: DeviceCreationRecord): Uint8Array {
  return utils.concatArrays(
    userDevice.ephemeral_public_signature_key,
    userDevice.user_id,
    userDevice.delegation_signature,
    userDevice.public_signature_key,
    userDevice.public_encryption_key,
  );
}

export function generatorDeviceToDevice(u: GeneratorDevice): Device {
  return {
    deviceId: u.id,
    devicePublicEncryptionKey: u.encryptionKeys.publicKey,
    devicePublicSignatureKey: u.signKeys.publicKey,
    isGhostDevice: false,
    createdAt: 0,
    revokedAt: Number.MAX_SAFE_INTEGER,
  };
}

export type GeneratorUserResult = {
  entry: UnverifiedEntry,
  block: Block,
  user: GeneratorUser,
  device: GeneratorDevice,
  blockPrivateSignatureKey: Uint8Array,
  unverifiedDeviceCreation: DeviceCreationEntry,
}

type CreateUserResult = {
  block: Block,
  entry: UnverifiedEntry,
  device: GeneratorDevice,
  blockPrivateSignatureKey: Uint8Array,
  unverifiedDeviceCreation: DeviceCreationEntry,
}

const rootBlockAuthor = new Uint8Array(32);

class Generator {
  trustchainId: Uint8Array;
  trustchainIndex: number = 1;
  appSignKeys: Object;
  pushedBlocks: Array<Block>;
  root: { block: Block, entry: TrustchainCreationEntry };
  users: { [userId: string]: GeneratorUser } = {};
  usersDevices: { [deviceId: string]: string } = {};

  constructor(trustchainId: Uint8Array, rootBlock: Block, appSignKeys: Object) {
    this.trustchainId = trustchainId;
    this.appSignKeys = appSignKeys;
    this.pushedBlocks = [rootBlock];
    this.root = {
      block: rootBlock,
      entry: trustchainCreationFromBlock(utils.toBase64(serializeBlock(rootBlock))),
    };
  }

  static async open(appSignKeys: Object): Promise<Generator> {
    // force a copy here or some tests will break
    const payload = { public_signature_key: new Uint8Array(appSignKeys.publicKey) };
    const rootBlock = {
      index: 1,
      trustchain_id: new Uint8Array(0),
      nature: preferredNature(NATURE_KIND.trustchain_creation),
      author: rootBlockAuthor,
      payload: serializeTrustchainCreation(payload),
      signature: new Uint8Array(tcrypto.SIGNATURE_SIZE) };
    rootBlock.trustchain_id = hashBlock(rootBlock);
    return new Generator(rootBlock.trustchain_id, rootBlock, appSignKeys);
  }

  createUser(args: { userId: string, parentDevice?: GeneratorDevice, userKeys: tcrypto.SodiumKeyPair, nature: Nature}): CreateUserResult {
    const ephemeralKeys = tcrypto.makeSignKeyPair();
    const signKeys = tcrypto.makeSignKeyPair();
    const encryptionKeys = tcrypto.makeEncryptionKeyPair();

    const obfuscatedUserId = obfuscateUserId(this.trustchainId, args.userId);
    const delegationBuffer = utils.concatArrays(ephemeralKeys.publicKey, obfuscatedUserId);

    let authorPrivateKey = this.appSignKeys.privateKey;
    let author = this.root.entry.hash;
    if (args.parentDevice) {
      // A parent device exists so we are in the add Device case
      authorPrivateKey = args.parentDevice.signKeys.privateKey;
      author = args.parentDevice.id;
    }
    let userKeyPair = null;
    if (args.nature === NATURE.device_creation_v3) {
      userKeyPair = {
        public_encryption_key: args.userKeys.publicKey,
        encrypted_private_encryption_key: new Uint8Array(SEALED_KEY_SIZE),
      };
    }
    const payload: DeviceCreationRecord = {
      last_reset: new Uint8Array(tcrypto.HASH_SIZE),
      ephemeral_public_signature_key: ephemeralKeys.publicKey,
      user_id: obfuscatedUserId,
      delegation_signature: tcrypto.sign(delegationBuffer, authorPrivateKey),
      public_signature_key: signKeys.publicKey,
      public_encryption_key: encryptionKeys.publicKey,
      is_ghost_device: false,
      revoked: Number.MAX_SAFE_INTEGER,
      user_key_pair: userKeyPair,
    };
    this.trustchainIndex += 1;

    let serializedPayload = null;
    if (args.nature === NATURE.device_creation_v3) {
      serializedPayload = serializeUserDeviceV3(payload);
    } else {
      serializedPayload = serializeUserDeviceV1(payload);
    }

    const block = signBlock({
      index: this.trustchainIndex,
      trustchain_id: this.trustchainId,
      nature: args.nature,
      author,
      payload: serializedPayload,
    }, ephemeralKeys.privateKey);

    const entry = deviceCreationFromBlock(block);
    const device = { id: entry.hash, signKeys, encryptionKeys };
    // $FlowIKnow
    return { block, entry, device, blockPrivateSignatureKey: ephemeralKeys.privateKey, unverifiedDeviceCreation: entry };
  }


  async newUserCreationV3(userId: string, { unsafe }: { unsafe?: bool } = {}): Promise<GeneratorUserResult> {
    if (!unsafe && this.users[userId])
      throw new Error(`Generator: user ${userId} already exists`);
    const userKeys = tcrypto.makeEncryptionKeyPair();

    const result = this.createUser({ userId, userKeys, nature: NATURE.device_creation_v3 });

    const user = { id: userId, userKeys, devices: [result.device] };
    this.users[userId] = user;
    this.usersDevices[utils.toBase64(result.entry.hash)] = userId;

    this.pushedBlocks.push(result.block);
    return {
      ...result,
      user,
    };
  }

  async newDeviceCreationV1(args: { userId: string, parentIndex: number }): Promise<GeneratorUserResult> {
    const { userId, parentIndex } = args;
    if (!this.users[userId])
      throw new Error(`Generator: cannot add device: ${userId} does not exist`);
    const user = this.users[userId];
    const { devices } = user;
    if (parentIndex > devices.length)
      throw new Error('Generator: cannot add device: index out of bounds');
    const parentDevice = devices[parentIndex];

    const result = this.createUser({ userId, userKeys: tcrypto.makeEncryptionKeyPair(), parentDevice, nature: NATURE.device_creation_v1 });

    this.users[userId] = { ...user, devices: [...user.devices, result.device] };
    this.usersDevices[utils.toBase64(result.entry.hash)] = userId;

    this.pushedBlocks.push(result.block);
    return {
      ...result,
      user: { ...this.users[userId] },
    };
  }

  async newDeviceCreationV3(args: { userId: string, parentIndex: number }): Promise<GeneratorUserResult> {
    const { userId, parentIndex } = args;
    if (!this.users[userId])
      throw new Error(`Generator: cannot add device: ${userId} does not exist`);
    const user = this.users[userId];
    const { userKeys, devices } = user;
    if (!userKeys)
      throw new Error('Generator: cannot add a deviceCreationV3 on a user V1');
    if (parentIndex > devices.length)
      throw new Error('Generator: cannot add device: index out of bounds');
    const parentDevice = devices[parentIndex];

    const result = this.createUser({ userId, userKeys, parentDevice, nature: NATURE.device_creation_v3 });

    this.users[userId] = { ...user, devices: [...user.devices, result.device] };
    this.usersDevices[utils.toBase64(result.entry.hash)] = userId;

    this.pushedBlocks.push(result.block);
    return {
      ...result,
      user: { ...this.users[userId] },
    };
  }

  userId(userName: string): Uint8Array {
    return obfuscateUserId(this.trustchainId, userName);
  }
}

export async function makeGenerator() {
  const trustchainKeyPair = tcrypto.makeSignKeyPair();
  const generator = await Generator.open(trustchainKeyPair);

  return {
    trustchainKeyPair,
    generator,
  };
}

export default Generator;
