// @flow
import varint from 'varint';
import { tcrypto, utils } from '@tanker/crypto';

import { type Block } from './Block';
import { UpgradeRequiredError } from '../errors';
import { getArray, getStaticArray, concatArrays, encodeArrayLength, encodeListLength, unserializeGenericSub, unserializeGeneric, unserializeList } from './Serialize';

export const NATURE_KIND = Object.freeze({
  trustchain_creation: 0,
  device_creation: 1,
  device_revocation: 2,
  key_publish_to_device: 3,
  key_publish_to_user: 4,
  user_group_creation: 5,
  key_publish_to_user_group: 6,
  user_group_addition: 7,
});

export type NatureKind = $Values<typeof NATURE_KIND>;


export const NATURE = Object.freeze({
  trustchain_creation: 1,
  device_creation_v1: 2,
  key_publish_to_device: 3,
  device_revocation_v1: 4,
  device_creation_v2: 6,
  device_creation_v3: 7,
  key_publish_to_user: 8,
  device_revocation_v2: 9,
  user_group_creation: 10,
  key_publish_to_user_group: 11,
  user_group_addition: 12,
});

export type Nature = $Values<typeof NATURE>;

export type TrustchainCreationRecord = {|
  public_signature_key: Uint8Array,
|}

export type UserPrivateKey = {|
  recipient: Uint8Array,
  key: Uint8Array,
|}

export type UserKeyPair = {|
  public_encryption_key: Uint8Array,
  encrypted_private_encryption_key: Uint8Array,
|}

export type UserKeys = {|
  public_encryption_key: Uint8Array,
  previous_public_encryption_key: Uint8Array,
  encrypted_previous_encryption_key: Uint8Array,
  private_keys: Array<UserPrivateKey>,
|}

export type UserDeviceRecord = {|
  last_reset: Uint8Array,
  ephemeral_public_signature_key: Uint8Array,
  user_id: Uint8Array,
  delegation_signature: Uint8Array,
  public_signature_key: Uint8Array,
  public_encryption_key: Uint8Array,
  user_key_pair: ?UserKeyPair,
  is_ghost_device: bool,
  is_server_device: bool,

  revoked: number,
|}

// the recipient is a Device Key
export type KeyPublishRecord = {|
  recipient: Uint8Array,
  resourceId: Uint8Array,
  key: Uint8Array,
|}

// the recipient is a User Key
export type KeyPublishToUserRecord = KeyPublishRecord;

// the recipient is a Group Public Key
export type KeyPublishToUserGroupRecord = KeyPublishRecord;

export type DeviceRevocationRecord = {|
  device_id: Uint8Array,
  user_keys?: UserKeys,
|}

export type GroupEncryptedKey = {|
  public_user_encryption_key: Uint8Array,
  encrypted_group_private_encryption_key: Uint8Array,
|}

export type UserGroupCreationRecord = {|
  public_encryption_key: Uint8Array,
  public_signature_key: Uint8Array,
  encrypted_group_private_signature_key: Uint8Array,
  encrypted_group_private_encryption_keys_for_users: Array<GroupEncryptedKey>,
  self_signature: Uint8Array,
|}

export type UserGroupAdditionRecord = {|
  group_id: Uint8Array,
  previous_group_block: Uint8Array,
  encrypted_group_private_encryption_keys_for_users: Array<GroupEncryptedKey>,
  self_signature_with_current_key: Uint8Array,
|}
export type UserGroupRecord = UserGroupCreationRecord | UserGroupAdditionRecord

export type Record = TrustchainCreationRecord | UserDeviceRecord | KeyPublishRecord | KeyPublishToUserRecord | KeyPublishToUserGroupRecord | DeviceRevocationRecord | UserGroupCreationRecord | UserGroupAdditionRecord;

/***
 * Do NOT increment the version without reading this first, or you WILL screw things up further.
 * In the format v1 the version field was not signed, this becomes a problem as soon as we have more than one version, so read up.
 *
 * What's the big deal? Well not signing allows attackers to change the version while still passing the payload verif,
 * meaning if you add new fields they can be ignored, if you change/remove fields Bad Things™ happen (google.com/search?q=type+confusion)
 *
 * Checklist:
 * 1. Make sure the version is signed starting with the v2 format
 * 2. As soon as possible start rejecting v1 blocks unconditionally
 * 3. Until step 2 is done:
 *      - Consider any new field you add the end to be optional/ignored,
 *      - Don't make breaking change to the binary serialization format (unless you can guarantee all v2 blocks are not valid v1 blocks),
 *      - Any block ABI break (removing or changing a field, inserting a field not at the end, ...) is a potential vuln
 **/
const currentVersion = 1;

const hashSize = tcrypto.HASH_SIZE;
const signatureSize = tcrypto.SIGNATURE_SIZE;
const trustchainIdSize = hashSize;

export function preferredNature(kind: NatureKind): Nature {
  switch (kind) {
    case NATURE_KIND.trustchain_creation: return NATURE.trustchain_creation;
    case NATURE_KIND.key_publish_to_device: return NATURE.key_publish_to_device;
    case NATURE_KIND.key_publish_to_user: return NATURE.key_publish_to_user;
    case NATURE_KIND.key_publish_to_user_group: return NATURE.key_publish_to_user_group;
    case NATURE_KIND.device_revocation: return NATURE.device_revocation_v2;
    case NATURE_KIND.device_creation: return NATURE.device_creation_v3;
    case NATURE_KIND.user_group_creation: return NATURE.user_group_creation;
    case NATURE_KIND.user_group_addition: return NATURE.user_group_addition;
    default: throw new Error(`invalid kind: ${kind}`);
  }
}


export function natureKind(val: Nature): NatureKind {
  switch (val) {
    case NATURE.trustchain_creation: return NATURE_KIND.trustchain_creation;
    case NATURE.device_creation_v1: return NATURE_KIND.device_creation;
    case NATURE.device_creation_v2: return NATURE_KIND.device_creation;
    case NATURE.device_creation_v3: return NATURE_KIND.device_creation;
    case NATURE.key_publish_to_device: return NATURE_KIND.key_publish_to_device;
    case NATURE.key_publish_to_user: return NATURE_KIND.key_publish_to_user;
    case NATURE.key_publish_to_user_group: return NATURE_KIND.key_publish_to_user_group;
    case NATURE.device_revocation_v1: return NATURE_KIND.device_revocation;
    case NATURE.device_revocation_v2: return NATURE_KIND.device_revocation;
    case NATURE.user_group_creation: return NATURE_KIND.user_group_creation;
    case NATURE.user_group_addition: return NATURE_KIND.user_group_addition;
    default: throw new Error(`invalid nature: ${val}`);
  }
}

export function isTrustchainCreation(nature: Nature): bool {
  return natureKind(nature) === NATURE_KIND.trustchain_creation;
}

export function isDeviceCreation(nature: Nature): bool {
  return natureKind(nature) === NATURE_KIND.device_creation;
}

export function isDeviceRevocation(nature: Nature): bool {
  return natureKind(nature) === NATURE_KIND.device_revocation;
}

export function isKeyPublishToDevice(nature: Nature): bool {
  return natureKind(nature) === NATURE_KIND.key_publish_to_device;
}

export function isKeyPublishToUser(nature: Nature): bool {
  return natureKind(nature) === NATURE_KIND.key_publish_to_user;
}

export function isKeyPublishToUserGroup(nature: Nature): bool {
  return natureKind(nature) === NATURE_KIND.key_publish_to_user_group;
}

export function isKeyPublish(nature: Nature): bool {
  return isKeyPublishToDevice(nature) ||
  isKeyPublishToUser(nature) ||
  isKeyPublishToUserGroup(nature);
}

export function isUserGroup(nature: Nature): bool {
  return natureKind(nature) === NATURE_KIND.user_group_creation ||
  natureKind(nature) === NATURE_KIND.user_group_addition;
}

export function natureToString(val: number): string {
  switch (val) {
    case NATURE.trustchain_creation: return 'trustchain_creation';
    case NATURE.device_creation_v1: return 'device_creation_v1';
    case NATURE.key_publish_to_device: return 'key_publish_to_device';
    case NATURE.device_revocation_v1: return 'device_revocation_v1';
    case NATURE.device_creation_v2: return 'device_creation_v2';
    case NATURE.device_creation_v3: return 'device_creation_v3';
    case NATURE.key_publish_to_user: return 'key_publish_to_user';
    case NATURE.device_revocation_v2: return 'device_revocation_v2';
    case NATURE.user_group_creation: return 'user_group_creation';
    case NATURE.key_publish_to_user_group: return 'key_publish_to_user_group';
    case NATURE.user_group_addition: return 'user_group_addition';
    default: throw new Error(`invalid nature: ${val}`);
  }
}

export function naturesFromKind(kind: NatureKind): Array<Nature> {
  switch (kind) {
    case NATURE_KIND.trustchain_creation:
      return [
        NATURE.trustchain_creation,
      ];
    case NATURE_KIND.key_publish_to_device:
      return [
        NATURE.key_publish_to_device,
      ];
    case NATURE_KIND.key_publish_to_user:
      return [
        NATURE.key_publish_to_user,
      ];
    case NATURE_KIND.key_publish_to_user_group:
      return [
        NATURE.key_publish_to_user_group,
      ];
    case NATURE_KIND.device_revocation:
      return [
        NATURE.device_revocation_v1,
        NATURE.device_revocation_v2,
      ];
    case NATURE_KIND.device_creation:
      return [
        NATURE.device_creation_v1,
        NATURE.device_creation_v2,
        NATURE.device_creation_v3,
      ];
    case NATURE_KIND.user_group_creation:
      return [
        NATURE.user_group_creation,
      ];
    case NATURE_KIND.user_group_addition:
      return [
        NATURE.user_group_addition,
      ];
    default: throw new Error(`invalid kind: ${kind}`);
  }
}

export function serializeBlock(block: Block): Uint8Array {
  if (block.author.length !== hashSize)
    throw new Error('Assertion error: invalid block author size');
  if (block.signature.length !== signatureSize)
    throw new Error('Assertion error: invalid block signature size');
  if (block.trustchain_id.length !== trustchainIdSize)
    throw new Error('Assertion error: invalid block trustchain_id size');

  return concatArrays(
    varint.encode(currentVersion),
    varint.encode(block.index),
    block.trustchain_id,
    varint.encode(block.nature),
    encodeArrayLength(block.payload), block.payload,
    block.author,
    block.signature
  );
}

export function unserializeBlock(src: Uint8Array): Block {
  let newOffset = 0;
  let value;
  const version = varint.decode(src, newOffset);
  newOffset += varint.decode.bytes;
  if (version > currentVersion)
    throw new UpgradeRequiredError(`unsupported block version: ${version}`);
  const index = varint.decode(src, newOffset);
  newOffset += varint.decode.bytes;
  ({ value, newOffset } = getStaticArray(src, trustchainIdSize, newOffset));
  const trustchain_id = value; // eslint-disable-line camelcase
  value = varint.decode(src, newOffset);
  newOffset += varint.decode.bytes;
  const nature = value;
  ({ value, newOffset } = getArray(src, newOffset));
  const payload = value;
  ({ value, newOffset } = getStaticArray(src, hashSize, newOffset));
  const author = value;
  ({ value, newOffset } = getStaticArray(src, signatureSize, newOffset));
  const signature = value;

  return { index, trustchain_id, nature, payload, author, signature };
}

export function serializeTrustchainCreation(trustchainCreation: TrustchainCreationRecord): Uint8Array {
  if (trustchainCreation.public_signature_key.length !== tcrypto.SIGNATURE_PUBLIC_KEY_SIZE)
    throw new Error('Assertion error: invalid trustchain public key size');

  return trustchainCreation.public_signature_key;
}

export function unserializeTrustchainCreation(src: Uint8Array): TrustchainCreationRecord {
  const { value } = getStaticArray(src, tcrypto.SIGNATURE_PUBLIC_KEY_SIZE, 0);
  return { public_signature_key: value };
}

function serializePrivateKey(userKey: UserPrivateKey): Uint8Array {
  return concatArrays(userKey.recipient, userKey.key);
}

function serializeUserKeyPair(userKeyPair: UserKeyPair): Uint8Array {
  return concatArrays(userKeyPair.public_encryption_key, userKeyPair.encrypted_private_encryption_key);
}

function serializeUserKeys(userKeys: UserKeys): Uint8Array {
  return concatArrays(
    userKeys.public_encryption_key,
    userKeys.previous_public_encryption_key,
    userKeys.encrypted_previous_encryption_key,
    encodeListLength(userKeys.private_keys),
    ...userKeys.private_keys.map(serializePrivateKey),
  );
}

export function serializeUserDeviceV1(userDevice: UserDeviceRecord): Uint8Array {
  if (!utils.equalArray(userDevice.last_reset, new Uint8Array(tcrypto.HASH_SIZE)))
    throw new Error('Assertion error: user device last reset must be null');
  if (userDevice.ephemeral_public_signature_key.length !== tcrypto.SIGNATURE_PUBLIC_KEY_SIZE)
    throw new Error('Assertion error: invalid user device ephemeral public signature key size');
  if (userDevice.user_id.length !== tcrypto.HASH_SIZE)
    throw new Error('Assertion error: invalid user device user id size');
  if (userDevice.delegation_signature.length !== tcrypto.SIGNATURE_SIZE)
    throw new Error('Assertion error: invalid user device delegation signature size');
  if (userDevice.public_signature_key.length !== tcrypto.SIGNATURE_PUBLIC_KEY_SIZE)
    throw new Error('Assertion error: invalid user device public signature key size');
  if (userDevice.public_encryption_key.length !== tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE)
    throw new Error('Assertion error: invalid user device public encryption key size');

  return concatArrays(
    userDevice.ephemeral_public_signature_key,
    userDevice.user_id,
    userDevice.delegation_signature,
    userDevice.public_signature_key,
    userDevice.public_encryption_key,
  );
}

export function serializeUserDeviceV3(userDevice: UserDeviceRecord): Uint8Array {
  if (!utils.equalArray(userDevice.last_reset, new Uint8Array(tcrypto.HASH_SIZE)))
    throw new Error('Assertion error: user device last reset must be null');
  if (userDevice.ephemeral_public_signature_key.length !== tcrypto.SIGNATURE_PUBLIC_KEY_SIZE)
    throw new Error('Assertion error: invalid user device ephemeral public signature key size');
  if (userDevice.user_id.length !== tcrypto.HASH_SIZE)
    throw new Error('Assertion error: invalid user device user id size');
  if (userDevice.delegation_signature.length !== tcrypto.SIGNATURE_SIZE)
    throw new Error('Assertion error: invalid user device delegation signature size');
  if (userDevice.public_signature_key.length !== tcrypto.SIGNATURE_PUBLIC_KEY_SIZE)
    throw new Error('Assertion error: invalid user device public signature key size');
  if (userDevice.public_encryption_key.length !== tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE)
    throw new Error('Assertion error: invalid user device public encryption key size');
  if (!userDevice.user_key_pair)
    throw new Error('Assertion error: invalid user device user key pair');
  if (userDevice.user_key_pair.public_encryption_key.length !== tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE)
    throw new Error('Assertion error: invalid user device user public encryption key size');
  if (userDevice.user_key_pair.encrypted_private_encryption_key.length !== tcrypto.SEALED_KEY_SIZE)
    throw new Error('Assertion error: invalid user device user encrypted private encryption key size');

  const deviceFlags = new Uint8Array(1);
  deviceFlags[0] = ((userDevice.is_server_device ? 1 : 0) << 1) | (userDevice.is_ghost_device ? 1 : 0); // eslint-disable-line no-bitwise

  return concatArrays(
    userDevice.ephemeral_public_signature_key,
    userDevice.user_id,
    userDevice.delegation_signature,
    userDevice.public_signature_key,
    userDevice.public_encryption_key,
    // $FlowIssue user_key_pair is not null, I checked for that...
    serializeUserKeyPair(userDevice.user_key_pair),
    deviceFlags,
  );
}

function unserializePrivateKey(src: Uint8Array, offset: number) {
  return unserializeGenericSub(src, [
    (d, o) => getStaticArray(d, tcrypto.HASH_SIZE, o, 'recipient'),
    (d, o) => getStaticArray(d, tcrypto.SEALED_KEY_SIZE, o, 'key'),
  ], offset);
}

function unserializeUserKeyPair(src: Uint8Array, offset: number) {
  return unserializeGenericSub(src, [
    (d, o) => getStaticArray(d, tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE, o, 'public_encryption_key'),
    (d, o) => getStaticArray(d, tcrypto.SEALED_KEY_SIZE, o, 'encrypted_private_encryption_key'),
  ], offset, 'user_key_pair');
}

function unserializeUserKeys(src: Uint8Array, offset: number) {
  return unserializeGenericSub(src, [
    (d, o) => getStaticArray(d, tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE, o, 'public_encryption_key'),
    (d, o) => getStaticArray(d, tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE, o, 'previous_public_encryption_key'),
    (d, o) => getStaticArray(d, tcrypto.SEALED_KEY_SIZE, o, 'encrypted_previous_encryption_key'),
    (d, o) => unserializeList(d, unserializePrivateKey, o, 'private_keys'),
  ], offset, 'user_keys');
}

export function unserializeUserDeviceV1(src: Uint8Array): UserDeviceRecord {
  return unserializeGeneric(src, [
    (d, o) => ({ last_reset: new Uint8Array(tcrypto.HASH_SIZE), newOffset: o }),
    (d, o) => getStaticArray(d, tcrypto.SIGNATURE_PUBLIC_KEY_SIZE, o, 'ephemeral_public_signature_key'),
    (d, o) => getStaticArray(d, tcrypto.HASH_SIZE, o, 'user_id'),
    (d, o) => getStaticArray(d, tcrypto.SIGNATURE_SIZE, o, 'delegation_signature'),
    (d, o) => getStaticArray(d, tcrypto.SIGNATURE_PUBLIC_KEY_SIZE, o, 'public_signature_key'),
    (d, o) => getStaticArray(d, tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE, o, 'public_encryption_key'),
    (d, o) => ({ user_key_pair: null, newOffset: o }),
    (d, o) => ({ is_ghost_device: false, newOffset: o }),
    (d, o) => ({ is_server_device: false, newOffset: o }),
    (d, o) => ({ revoked: Number.MAX_SAFE_INTEGER, newOffset: o }),
  ]);
}

export function unserializeUserDeviceV2(src: Uint8Array): UserDeviceRecord {
  return unserializeGeneric(src, [
    (d, o) => getStaticArray(d, tcrypto.HASH_SIZE, o, 'last_reset'),
    (d, o) => getStaticArray(d, tcrypto.SIGNATURE_PUBLIC_KEY_SIZE, o, 'ephemeral_public_signature_key'),
    (d, o) => getStaticArray(d, tcrypto.HASH_SIZE, o, 'user_id'),
    (d, o) => getStaticArray(d, tcrypto.SIGNATURE_SIZE, o, 'delegation_signature'),
    (d, o) => getStaticArray(d, tcrypto.SIGNATURE_PUBLIC_KEY_SIZE, o, 'public_signature_key'),
    (d, o) => getStaticArray(d, tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE, o, 'public_encryption_key'),
    (d, o) => ({ user_key_pair: null, newOffset: o }),
    (d, o) => ({ is_ghost_device: false, newOffset: o }),
    (d, o) => ({ is_server_device: false, newOffset: o }),
    (d, o) => ({ revoked: Number.MAX_SAFE_INTEGER, newOffset: o }),
  ]);
}

export function unserializeUserDeviceV3(src: Uint8Array): UserDeviceRecord {
  return unserializeGeneric(src, [
    (d, o) => ({ last_reset: new Uint8Array(tcrypto.HASH_SIZE), newOffset: o }),
    (d, o) => getStaticArray(d, tcrypto.SIGNATURE_PUBLIC_KEY_SIZE, o, 'ephemeral_public_signature_key'),
    (d, o) => getStaticArray(d, tcrypto.HASH_SIZE, o, 'user_id'),
    (d, o) => getStaticArray(d, tcrypto.SIGNATURE_SIZE, o, 'delegation_signature'),
    (d, o) => getStaticArray(d, tcrypto.SIGNATURE_PUBLIC_KEY_SIZE, o, 'public_signature_key'),
    (d, o) => getStaticArray(d, tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE, o, 'public_encryption_key'),
    (d, o) => unserializeUserKeyPair(d, o),
    (d, o) => ({ is_ghost_device: !!(d[o] & 0x01), newOffset: o }), // eslint-disable-line no-bitwise
    (d, o) => ({ is_server_device: !!(d[o] & 0x02), newOffset: o + 1 }), // eslint-disable-line no-bitwise
    (d, o) => ({ revoked: Number.MAX_SAFE_INTEGER, newOffset: o }),
  ]);
}

export function serializeKeyPublish(keyPublish: KeyPublishRecord): Uint8Array {
  if (keyPublish.recipient.length !== hashSize)
    throw new Error('Assertion error: invalid key publish recipient size');
  if (keyPublish.resourceId.length !== tcrypto.MAC_SIZE)
    throw new Error('Assertion error: invalid key publish MAC size');
  if (keyPublish.key.length !== tcrypto.SYMMETRIC_KEY_SIZE + tcrypto.XCHACHA_IV_SIZE + tcrypto.MAC_SIZE)
    throw new Error('Assertion error: invalid key publish key size');

  return concatArrays(
    keyPublish.recipient,
    keyPublish.resourceId,
    encodeArrayLength(keyPublish.key), keyPublish.key
  );
}

export function serializeKeyPublishToUser(keyPublish: KeyPublishToUserRecord): Uint8Array {
  if (keyPublish.recipient.length !== hashSize)
    throw new Error('Assertion error: invalid key publish recipient size');
  if (keyPublish.resourceId.length !== tcrypto.MAC_SIZE)
    throw new Error('Assertion error: invalid key publish MAC size');
  if (keyPublish.key.length !== tcrypto.SEALED_KEY_SIZE)
    throw new Error('Assertion error: invalid key publish key size');

  return concatArrays(
    keyPublish.recipient,
    keyPublish.resourceId,
    keyPublish.key,
  );
}

export function serializeKeyPublishToUserGroup(keyPublish: KeyPublishToUserGroupRecord): Uint8Array {
  if (keyPublish.recipient.length !== tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE)
    throw new Error('Assertion error: invalid key publish to user group recipient size');
  if (keyPublish.resourceId.length !== tcrypto.MAC_SIZE)
    throw new Error('Assertion error: invalid key publish to user group MAC size');
  if (keyPublish.key.length !== tcrypto.SEALED_KEY_SIZE)
    throw new Error('Assertion error: invalid key publish to user group key size');

  return concatArrays(
    keyPublish.recipient,
    keyPublish.resourceId,
    keyPublish.key,
  );
}

export function unserializeKeyPublish(src: Uint8Array): KeyPublishRecord {
  const result = unserializeGeneric(src, [
    (d, o) => getStaticArray(d, hashSize, o, 'recipient'),
    (d, o) => getStaticArray(d, tcrypto.MAC_SIZE, o, 'resourceId'),
    (d, o) => getArray(d, o, 'key'),
  ]);

  if (result.key.length !== tcrypto.SYMMETRIC_KEY_SIZE + tcrypto.XCHACHA_IV_SIZE + tcrypto.MAC_SIZE)
    throw new Error('invalid key publish key size');
  return result;
}

export function unserializeKeyPublishToUser(src: Uint8Array): KeyPublishToUserRecord {
  return unserializeGeneric(src, [
    (d, o) => getStaticArray(d, hashSize, o, 'recipient'),
    (d, o) => getStaticArray(d, tcrypto.MAC_SIZE, o, 'resourceId'),
    (d, o) => getStaticArray(d, tcrypto.SEALED_KEY_SIZE, o, 'key'),
  ]);
}

export function unserializeKeyPublishToUserGroup(src: Uint8Array): KeyPublishToUserGroupRecord {
  return unserializeGeneric(src, [
    (d, o) => getStaticArray(d, tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE, o, 'recipient'),
    (d, o) => getStaticArray(d, tcrypto.MAC_SIZE, o, 'resourceId'),
    (d, o) => getStaticArray(d, tcrypto.SEALED_KEY_SIZE, o, 'key'),
  ]);
}

export function serializeDeviceRevocationV1(deviceRevocation: DeviceRevocationRecord): Uint8Array {
  if (deviceRevocation.device_id.length !== hashSize)
    throw new Error('Assertion error: invalid device revocation device_id size');

  return deviceRevocation.device_id;
}

export function serializeDeviceRevocationV2(deviceRevocation: DeviceRevocationRecord): Uint8Array {
  if (deviceRevocation.device_id.length !== hashSize)
    throw new Error('Assertion error: invalid device revocation device_id size');
  if (!deviceRevocation.user_keys)
    throw new Error('Assertion error: invalid user device user keys');
  if (deviceRevocation.user_keys.public_encryption_key.length !== tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE)
    throw new Error('Assertion error: invalid user device user public encryption key size');
  if (deviceRevocation.user_keys.previous_public_encryption_key.length !== tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE)
    throw new Error('Assertion error: invalid user device user previous public encryption key size');
  if (deviceRevocation.user_keys.encrypted_previous_encryption_key.length !== tcrypto.SEALED_KEY_SIZE)
    throw new Error('Assertion error: invalid user device user previous encrypted private encryption key size');
  for (const key of deviceRevocation.user_keys.private_keys) {
    if (key.recipient.length !== tcrypto.HASH_SIZE)
      throw new Error('Assertion error: invalid user device encrypted key recipient size');
    if (key.key.length !== tcrypto.SEALED_KEY_SIZE)
      throw new Error('Assertion error: invalid user device user encrypted private encryption key size');
  }

  return concatArrays(
    deviceRevocation.device_id,
    serializeUserKeys(deviceRevocation.user_keys)
  );
}

export function unserializeDeviceRevocationV1(src: Uint8Array): DeviceRevocationRecord {
  return { device_id: getStaticArray(src, hashSize, 0).value };
}

export function unserializeDeviceRevocationV2(src: Uint8Array): DeviceRevocationRecord {
  return unserializeGeneric(src, [
    (d, o) => getStaticArray(d, hashSize, o, 'device_id'),
    (d, o) => unserializeUserKeys(d, o),
  ]);
}

function serializeGroupEncryptedKey(gek: GroupEncryptedKey): Uint8Array {
  return concatArrays(gek.public_user_encryption_key, gek.encrypted_group_private_encryption_key);
}

function unserializeGroupEncryptedKey(src: Uint8Array, offset: number) {
  return unserializeGenericSub(src, [
    (d, o) => getStaticArray(d, tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE, o, 'public_user_encryption_key'),
    (d, o) => getStaticArray(d, tcrypto.SEALED_ENCRYPTION_PRIVATE_KEY_SIZE, o, 'encrypted_group_private_encryption_key'),
  ], offset);
}

function checkGroupEncryptedKey(blockType: string, key: GroupEncryptedKey): void {
  if (key.public_user_encryption_key.length !== tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE)
    throw new Error(`Assertion error: invalid ${blockType} recipient user public key size`);
  if (key.encrypted_group_private_encryption_key.length !== tcrypto.SEALED_ENCRYPTION_PRIVATE_KEY_SIZE)
    throw new Error(`Assertion error: invalid ${blockType} encrypted group private encryption key size`);
}

export function serializeUserGroupCreation(userGroupCreation: UserGroupCreationRecord): Uint8Array {
  if (userGroupCreation.public_signature_key.length !== tcrypto.SIGNATURE_PUBLIC_KEY_SIZE)
    throw new Error('Assertion error: invalid user group creation group public signature key size');
  if (userGroupCreation.public_encryption_key.length !== tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE)
    throw new Error('Assertion error: invalid user group creation group public encryption key size');
  if (userGroupCreation.encrypted_group_private_signature_key.length !== tcrypto.SEALED_SIGNATURE_PRIVATE_KEY_SIZE)
    throw new Error('Assertion error: invalid user group creation encrypted group private signature key size');
  userGroupCreation.encrypted_group_private_encryption_keys_for_users.forEach(k => checkGroupEncryptedKey('user group creation', k));
  if (userGroupCreation.self_signature.length !== tcrypto.SIGNATURE_SIZE)
    throw new Error('Assertion error: invalid user group creation group self signature size');

  return concatArrays(
    userGroupCreation.public_signature_key,
    userGroupCreation.public_encryption_key,
    userGroupCreation.encrypted_group_private_signature_key,
    encodeListLength(userGroupCreation.encrypted_group_private_encryption_keys_for_users),
    ...userGroupCreation.encrypted_group_private_encryption_keys_for_users.map(serializeGroupEncryptedKey),
    userGroupCreation.self_signature,
  );
}

export function unserializeUserGroupCreation(src: Uint8Array): UserGroupCreationRecord {
  return unserializeGeneric(src, [
    (d, o) => getStaticArray(d, tcrypto.SIGNATURE_PUBLIC_KEY_SIZE, o, 'public_signature_key'),
    (d, o) => getStaticArray(d, tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE, o, 'public_encryption_key'),
    (d, o) => getStaticArray(d, tcrypto.SEALED_SIGNATURE_PRIVATE_KEY_SIZE, o, 'encrypted_group_private_signature_key'),
    (d, o) => unserializeList(d, unserializeGroupEncryptedKey, o, 'encrypted_group_private_encryption_keys_for_users'),
    (d, o) => getStaticArray(d, tcrypto.SIGNATURE_SIZE, o, 'self_signature'),
  ]);
}

export function serializeUserGroupAddition(userGroupAddition: UserGroupAdditionRecord): Uint8Array {
  if (userGroupAddition.previous_group_block.length !== tcrypto.HASH_SIZE)
    throw new Error('Assertion error: invalid user group addition previous group block size');
  userGroupAddition.encrypted_group_private_encryption_keys_for_users.forEach(k => checkGroupEncryptedKey('user group add', k));
  if (userGroupAddition.self_signature_with_current_key.length !== tcrypto.SIGNATURE_SIZE)
    throw new Error('Assertion error: invalid user group addition group self signature size');

  return concatArrays(
    userGroupAddition.group_id,
    userGroupAddition.previous_group_block,
    encodeListLength(userGroupAddition.encrypted_group_private_encryption_keys_for_users),
    ...userGroupAddition.encrypted_group_private_encryption_keys_for_users.map(serializeGroupEncryptedKey),
    userGroupAddition.self_signature_with_current_key,
  );
}

export function unserializeUserGroupAddition(src: Uint8Array): UserGroupAdditionRecord {
  return unserializeGeneric(src, [
    (d, o) => getStaticArray(d, tcrypto.HASH_SIZE, o, 'group_id'),
    (d, o) => getStaticArray(d, tcrypto.HASH_SIZE, o, 'previous_group_block'),
    (d, o) => unserializeList(d, unserializeGroupEncryptedKey, o, 'encrypted_group_private_encryption_keys_for_users'),
    (d, o) => getStaticArray(d, tcrypto.SIGNATURE_SIZE, o, 'self_signature_with_current_key'),
  ]);
}

export function unserializePayload(block: Block): Record {
  switch (block.nature) {
    case NATURE.trustchain_creation: return unserializeTrustchainCreation(block.payload);
    case NATURE.device_creation_v1: return unserializeUserDeviceV1(block.payload);
    case NATURE.device_creation_v2: return unserializeUserDeviceV2(block.payload);
    case NATURE.device_creation_v3: return unserializeUserDeviceV3(block.payload);
    case NATURE.key_publish_to_device: return unserializeKeyPublish(block.payload);
    case NATURE.key_publish_to_user: return unserializeKeyPublishToUser(block.payload);
    case NATURE.key_publish_to_user_group: return unserializeKeyPublishToUserGroup(block.payload);
    case NATURE.device_revocation_v1: return unserializeDeviceRevocationV1(block.payload);
    case NATURE.device_revocation_v2: return unserializeDeviceRevocationV2(block.payload);
    case NATURE.user_group_creation: return unserializeUserGroupCreation(block.payload);
    case NATURE.user_group_addition: return unserializeUserGroupAddition(block.payload);
    default: throw new UpgradeRequiredError(`unknown nature: ${block.nature}`);
  }
}
