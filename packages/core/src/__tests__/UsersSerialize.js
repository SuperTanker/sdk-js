// @flow

import { tcrypto, random, utils } from '@tanker/crypto';
import { expect } from '@tanker/test-utils';

import { encodeListLength } from '../Blocks/Serialize';
import { SEALED_KEY_SIZE } from '../Blocks/payloads';
import {
  serializeUserDeviceV3,
  unserializeUserDeviceV1,
  unserializeUserDeviceV2,
  unserializeUserDeviceV3,
  serializeDeviceRevocationV2,
  unserializeDeviceRevocationV1,
  unserializeDeviceRevocationV2,
} from '../Users/Serialize';


import { serializeUserDeviceV1 } from './Generator';

import makeUint8Array from './makeUint8Array';

// NOTE: If you ever have to change something here, change it in the Go code too!
// The test vectors should stay the same
describe('payload test vectors', () => {
  it('correctly deserializes a DeviceCreation v1 test vector', async () => {
    const deviceCreation = {
      ephemeral_public_signature_key: new Uint8Array([
        0x4e, 0x2a, 0x65, 0xdf, 0xe6, 0x5d, 0x00, 0x58, 0xf4, 0xdf, 0xb0, 0x5d, 0x37, 0x64, 0x18, 0x1d,
        0x10, 0x61, 0xf7, 0x54, 0xbb, 0x70, 0x30, 0x4f, 0x08, 0x6e, 0x32, 0x14, 0x85, 0x7a, 0xee, 0xe5
      ]),
      user_id: new Uint8Array([
        0xbd, 0xec, 0xe7, 0xbe, 0x4c, 0xd6, 0xc8, 0x33, 0xec, 0xf9, 0x42, 0xe1, 0xa9, 0xc4, 0xa7, 0x3e,
        0x39, 0xac, 0xdd, 0x6d, 0x99, 0x37, 0xc2, 0x9a, 0xbf, 0xf8, 0x6c, 0x4f, 0xce, 0x3a, 0x34, 0xcd
      ]),
      delegation_signature: new Uint8Array([
        0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA,
        0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA,
        0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA,
        0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA
      ]),
      public_signature_key: new Uint8Array([
        0x21, 0x2c, 0x54, 0x3a, 0xae, 0xcf, 0xc6, 0xef, 0x0b, 0x60, 0xae, 0xe6, 0x11, 0x52, 0xa1, 0x30,
        0x60, 0xbc, 0x34, 0xbc, 0x1b, 0x89, 0x39, 0xe1, 0xd9, 0x94, 0x9a, 0xaa, 0x14, 0x4c, 0x41, 0x60
      ]),
      public_encryption_key: new Uint8Array([
        0x42, 0x9a, 0xfa, 0x09, 0xee, 0xea, 0xce, 0x12, 0xec, 0x59, 0x06, 0x35, 0xa8, 0x7f, 0x82, 0xe6,
        0x39, 0xc8, 0xce, 0xd0, 0xc8, 0xe5, 0x57, 0x16, 0x72, 0x94, 0x9e, 0xfb, 0xed, 0x59, 0xde, 0x2e
      ]),
      user_key_pair: null,
      is_ghost_device: false,
      last_reset: new Uint8Array(tcrypto.HASH_SIZE),
      revoked: Number.MAX_SAFE_INTEGER,
    };

    const payload = utils.concatArrays(
      deviceCreation.ephemeral_public_signature_key,
      deviceCreation.user_id,
      deviceCreation.delegation_signature,
      deviceCreation.public_signature_key,
      deviceCreation.public_encryption_key
    );

    expect(unserializeUserDeviceV1(payload)).to.deep.equal(deviceCreation);
  });

  it('correctly deserializes a DeviceCreation v2 test vector', async () => {
    const deviceCreation = {
      last_reset: new Uint8Array(tcrypto.HASH_SIZE),
      ephemeral_public_signature_key: new Uint8Array([
        0x4e, 0x2a, 0x65, 0xdf, 0xe6, 0x5d, 0x00, 0x58, 0xf4, 0xdf, 0xb0, 0x5d, 0x37, 0x64, 0x18, 0x1d,
        0x10, 0x61, 0xf7, 0x54, 0xbb, 0x70, 0x30, 0x4f, 0x08, 0x6e, 0x32, 0x14, 0x85, 0x7a, 0xee, 0xe5
      ]),
      user_id: new Uint8Array([
        0xbd, 0xec, 0xe7, 0xbe, 0x4c, 0xd6, 0xc8, 0x33, 0xec, 0xf9, 0x42, 0xe1, 0xa9, 0xc4, 0xa7, 0x3e,
        0x39, 0xac, 0xdd, 0x6d, 0x99, 0x37, 0xc2, 0x9a, 0xbf, 0xf8, 0x6c, 0x4f, 0xce, 0x3a, 0x34, 0xcd
      ]),
      delegation_signature: new Uint8Array([
        0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA,
        0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA,
        0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA,
        0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA
      ]),
      public_signature_key: new Uint8Array([
        0x21, 0x2c, 0x54, 0x3a, 0xae, 0xcf, 0xc6, 0xef, 0x0b, 0x60, 0xae, 0xe6, 0x11, 0x52, 0xa1, 0x30,
        0x60, 0xbc, 0x34, 0xbc, 0x1b, 0x89, 0x39, 0xe1, 0xd9, 0x94, 0x9a, 0xaa, 0x14, 0x4c, 0x41, 0x60
      ]),
      public_encryption_key: new Uint8Array([
        0x42, 0x9a, 0xfa, 0x09, 0xee, 0xea, 0xce, 0x12, 0xec, 0x59, 0x06, 0x35, 0xa8, 0x7f, 0x82, 0xe6,
        0x39, 0xc8, 0xce, 0xd0, 0xc8, 0xe5, 0x57, 0x16, 0x72, 0x94, 0x9e, 0xfb, 0xed, 0x59, 0xde, 0x2e
      ]),
      user_key_pair: null,
      is_ghost_device: false,
      revoked: Number.MAX_SAFE_INTEGER,
    };

    const payload = utils.concatArrays(
      deviceCreation.last_reset,
      deviceCreation.ephemeral_public_signature_key,
      deviceCreation.user_id,
      deviceCreation.delegation_signature,
      deviceCreation.public_signature_key,
      deviceCreation.public_encryption_key
    );

    expect(unserializeUserDeviceV2(payload)).to.deep.equal(deviceCreation);
  });

  it('correctly deserializes a DeviceCreation v3 test vector', async () => {
    const payload = new Uint8Array([
      // ephemeral_public_signature_key
      0x65, 0x70, 0x68, 0x20, 0x70, 0x75, 0x62, 0x20, 0x6b, 0x65, 0x79, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // user_id
      0x75, 0x73, 0x65, 0x72, 0x20, 0x69, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // delegation_signature
      0x64, 0x65, 0x6c, 0x65, 0x67, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x20, 0x73,
      0x69, 0x67, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      // public_signature_key
      0x70, 0x75, 0x62, 0x6c, 0x69, 0x63, 0x20, 0x73, 0x69, 0x67, 0x6e, 0x61,
      0x74, 0x75, 0x72, 0x65, 0x20, 0x6b, 0x65, 0x79, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // public_encryption_key
      0x70, 0x75, 0x62, 0x6c, 0x69, 0x63, 0x20, 0x65, 0x6e, 0x63, 0x20, 0x6b,
      0x65, 0x79, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // user public_encryption_key
      0x75, 0x73, 0x65, 0x72, 0x20, 0x70, 0x75, 0x62, 0x20, 0x65, 0x6e, 0x63,
      0x20, 0x6b, 0x65, 0x79, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // user encrypted_private_encryption_key
      0x75, 0x73, 0x65, 0x72, 0x20, 0x65, 0x6e, 0x63, 0x20, 0x6b, 0x65, 0x79,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // is_ghost_device
      0x01,
    ]);

    const deviceCreation = {
      last_reset: new Uint8Array(32),
      ephemeral_public_signature_key: makeUint8Array('eph pub key', tcrypto.SIGNATURE_PUBLIC_KEY_SIZE),
      user_id: makeUint8Array('user id', tcrypto.HASH_SIZE),
      delegation_signature: makeUint8Array('delegation sig', tcrypto.SIGNATURE_SIZE),
      public_signature_key: makeUint8Array('public signature key', tcrypto.SIGNATURE_PUBLIC_KEY_SIZE),
      public_encryption_key: makeUint8Array('public enc key', tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE),
      user_key_pair: {
        public_encryption_key: makeUint8Array('user pub enc key', tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE),
        encrypted_private_encryption_key: makeUint8Array('user enc key', SEALED_KEY_SIZE),
      },
      is_ghost_device: true,
      revoked: Number.MAX_SAFE_INTEGER,
    };

    expect(unserializeUserDeviceV3(payload)).to.deep.equal(deviceCreation);
  });

  it('correctly deserializes a DeviceRevocationV1 test vector', async () => {
    const deviceRevocation = {
      device_id: new Uint8Array([
        0xe9, 0x0b, 0x0a, 0x13, 0x05, 0xb1, 0x82, 0x85, 0xab, 0x9d, 0xbe, 0x3f, 0xdb, 0x57, 0x2b, 0x71,
        0x6c, 0x0d, 0xa1, 0xa3, 0xad, 0xb8, 0x86, 0x9b, 0x39, 0x58, 0xcb, 0x00, 0xfa, 0x31, 0x5d, 0x87
      ]),
    };

    const payload = deviceRevocation.device_id;

    expect(unserializeDeviceRevocationV1(payload)).to.deep.equal(deviceRevocation);
  });

  it('correctly deserializes a DeviceRevocationV2 test vector', async () => {
    const deviceRevocation = {
      device_id: new Uint8Array([
        0xe9, 0x0b, 0x0a, 0x13, 0x05, 0xb1, 0x82, 0x85, 0xab, 0x9d, 0xbe, 0x3f, 0xdb, 0x57, 0x2b, 0x71,
        0x6c, 0x0d, 0xa1, 0xa3, 0xad, 0xb8, 0x86, 0x9b, 0x39, 0x58, 0xcb, 0x00, 0xfa, 0x31, 0x5d, 0x87
      ]),
      user_keys: {
        public_encryption_key: new Uint8Array([
          0x42, 0x9a, 0xfa, 0x09, 0xee, 0xea, 0xce, 0x12, 0xec, 0x59, 0x06, 0x35, 0xa8, 0x7f, 0x82, 0xe6,
          0x39, 0xc8, 0xce, 0xd0, 0xc8, 0xe5, 0x57, 0x16, 0x72, 0x94, 0x9e, 0xfb, 0xed, 0x59, 0xde, 0x2e
        ]),
        previous_public_encryption_key: new Uint8Array([
          0x8e, 0x3e, 0x33, 0x57, 0x3d, 0xd5, 0x3c, 0xe7, 0x29, 0xbc, 0x73, 0x90, 0x7f, 0x83, 0x20, 0xee,
          0xe9, 0x0b, 0x0a, 0x13, 0x05, 0xb1, 0x82, 0x85, 0xab, 0x9d, 0xbe, 0x3f, 0xdb, 0x57, 0x2b, 0x71,
        ]),
        encrypted_previous_encryption_key: new Uint8Array([
          0xf1, 0x28, 0xa8, 0x12, 0x03, 0x8e, 0x7c, 0x9c, 0x39, 0xad, 0x73, 0x21, 0xa3, 0xee, 0x50, 0x53,
          0xc1, 0x1d, 0xda, 0x76, 0xaf, 0xc8, 0xfd, 0x70, 0x74, 0x5c, 0xbb, 0xd6, 0xb8, 0x7f, 0x8f, 0x6b,
          0xe1, 0xaf, 0x36, 0x80, 0x3f, 0xf3, 0xbc, 0xb2, 0xfb, 0x4e, 0xe1, 0x7d, 0xea, 0xbd, 0x19, 0x6b,
          0x8e, 0x3e, 0x33, 0x57, 0x3d, 0xd5, 0x3c, 0xe7, 0x29, 0xbc, 0x73, 0x90, 0x7f, 0x83, 0x20, 0xee,
          0x0e, 0xc0, 0x91, 0x63, 0xe7, 0xc2, 0x04, 0x69, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]),
        private_keys: [
          {
            recipient: new Uint8Array([
              0xd0, 0xa8, 0x9e, 0xff, 0x7d, 0x59, 0x48, 0x3a, 0xee, 0x7c, 0xe4, 0x99, 0x49, 0x4d, 0x1c, 0xd7,
              0x87, 0x54, 0x41, 0xf5, 0xba, 0x51, 0xd7, 0x65, 0xbf, 0x91, 0x45, 0x08, 0x03, 0xf1, 0xe9, 0xc7,
            ]),
            key: new Uint8Array([
              0xe1, 0xaf, 0x36, 0x80, 0x3f, 0xf3, 0xbc, 0xb2, 0xfb, 0x4e, 0xe1, 0x7d, 0xea, 0xbd, 0x19, 0x6b,
              0x8e, 0x3e, 0x33, 0x57, 0x3d, 0xd5, 0x3c, 0xe7, 0x29, 0xbc, 0x73, 0x90, 0x7f, 0x83, 0x20, 0xee,
              0xf1, 0x28, 0xa8, 0x12, 0x03, 0x8e, 0x7c, 0x9c, 0x39, 0xad, 0x73, 0x21, 0xa3, 0xee, 0x50, 0x53,
              0xc1, 0x1d, 0xda, 0x76, 0xaf, 0xc8, 0xfd, 0x70, 0x74, 0x5c, 0xbb, 0xd6, 0xb8, 0x7f, 0x8f, 0x6b,
              0x0e, 0xc0, 0x91, 0x63, 0xe7, 0xc2, 0x04, 0x69, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            ]),
          },
        ],
      },
    };

    const payload = utils.concatArrays(
      deviceRevocation.device_id,
      deviceRevocation.user_keys.public_encryption_key,
      deviceRevocation.user_keys.previous_public_encryption_key,
      deviceRevocation.user_keys.encrypted_previous_encryption_key,
      encodeListLength(deviceRevocation.user_keys.private_keys),
      ...deviceRevocation.user_keys.private_keys.map((userKey) => utils.concatArrays(userKey.recipient, userKey.key)),
    );

    expect(unserializeDeviceRevocationV2(payload)).to.deep.equal(deviceRevocation);
  });
});

describe('payloads', () => {
  it('should serialize/unserialize a UserDeviceV1', async () => {
    const ephemeralKeys = tcrypto.makeSignKeyPair();
    const signatureKeys = tcrypto.makeSignKeyPair();
    const encryptionKeys = tcrypto.makeEncryptionKeyPair();
    const userDevice = {
      last_reset: new Uint8Array(tcrypto.HASH_SIZE),
      ephemeral_public_signature_key: ephemeralKeys.publicKey,
      user_id: utils.fromString('12341234123412341234123412341234'),
      delegation_signature: utils.fromString('1234123412341234123412341234123412341234123412341234123412341234'),
      public_signature_key: signatureKeys.publicKey,
      public_encryption_key: encryptionKeys.publicKey,
      user_key_pair: null,
      is_ghost_device: false,
      revoked: Number.MAX_SAFE_INTEGER,
    };

    expect(unserializeUserDeviceV1(serializeUserDeviceV1(userDevice))).to.deep.equal(userDevice);
  });

  it('should serialize/unserialize a UserDeviceV3', async () => {
    const ephemeralKeys = tcrypto.makeSignKeyPair();
    const signatureKeys = tcrypto.makeSignKeyPair();
    const encryptionKeys = tcrypto.makeEncryptionKeyPair();
    const userDevice = {
      last_reset: new Uint8Array(tcrypto.HASH_SIZE),
      ephemeral_public_signature_key: ephemeralKeys.publicKey,
      user_id: utils.fromString('12341234123412341234123412341234'),
      delegation_signature: utils.fromString('1234123412341234123412341234123412341234123412341234123412341234'),
      public_signature_key: signatureKeys.publicKey,
      public_encryption_key: encryptionKeys.publicKey,
      user_key_pair: {
        public_encryption_key: makeUint8Array('user pub enc key', tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE),
        encrypted_private_encryption_key: makeUint8Array('user enc priv key', SEALED_KEY_SIZE),
      },
      is_ghost_device: true,
      revoked: Number.MAX_SAFE_INTEGER,
    };

    expect(unserializeUserDeviceV3(serializeUserDeviceV3(userDevice))).to.deep.equal(userDevice);
  });

  it('should serialize/unserialize a DeviceRevocation', async () => {
    const deviceRevocation = {
      device_id: random(tcrypto.HASH_SIZE),
      user_keys: {
        public_encryption_key: random(tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE),
        previous_public_encryption_key: random(tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE),
        encrypted_previous_encryption_key: random(SEALED_KEY_SIZE),
        private_keys: [],
      },
    };

    expect(unserializeDeviceRevocationV2(serializeDeviceRevocationV2(deviceRevocation))).to.deep.equal(deviceRevocation);
  });

  it('should throw when serializing invalid revocation blocks', async () => {
    const initValidBlock = () => ({
      device_id: new Uint8Array(tcrypto.HASH_SIZE),
      user_keys: {
        public_encryption_key: new Uint8Array(tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE),
        previous_public_encryption_key: new Uint8Array(tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE),
        encrypted_previous_encryption_key: new Uint8Array(SEALED_KEY_SIZE),
        private_keys: [{
          recipient: new Uint8Array(tcrypto.HASH_SIZE),
          key: new Uint8Array(SEALED_KEY_SIZE),
        }],
      },
    });

    let invalidBlock = initValidBlock();
    invalidBlock.device_id = new Uint8Array(0);
    expect(() => serializeDeviceRevocationV2(invalidBlock)).to.throw();

    invalidBlock = initValidBlock();
    invalidBlock.user_keys = {};
    expect(() => serializeDeviceRevocationV2(invalidBlock)).to.throw();

    invalidBlock = initValidBlock();
    invalidBlock.user_keys.public_encryption_key = new Uint8Array(0);
    expect(() => serializeDeviceRevocationV2(invalidBlock)).to.throw();

    invalidBlock = initValidBlock();
    invalidBlock.user_keys.previous_public_encryption_key = new Uint8Array(0);
    expect(() => serializeDeviceRevocationV2(invalidBlock)).to.throw();

    invalidBlock = initValidBlock();
    invalidBlock.user_keys.encrypted_previous_encryption_key = new Uint8Array(0);
    expect(() => serializeDeviceRevocationV2(invalidBlock)).to.throw();

    invalidBlock = initValidBlock();
    invalidBlock.user_keys.private_keys[0].recipient = new Uint8Array(0);
    expect(() => serializeDeviceRevocationV2(invalidBlock)).to.throw();

    invalidBlock = initValidBlock();
    invalidBlock.user_keys.private_keys[0].key = new Uint8Array(0);
    expect(() => serializeDeviceRevocationV2(invalidBlock)).to.throw();
  });

  it('should throw if the last reset is not null when serializing a new userDeviceV3', async () => {
    const ephemeralKeys = tcrypto.makeSignKeyPair();
    const signatureKeys = tcrypto.makeSignKeyPair();
    const encryptionKeys = tcrypto.makeEncryptionKeyPair();
    const userDevice = {
      last_reset: new Uint8Array(Array.from({ length: tcrypto.HASH_SIZE }, () => 1)),
      ephemeral_public_signature_key: ephemeralKeys.publicKey,
      user_id: utils.fromString('12341234123412341234123412341234'),
      delegation_signature: utils.fromString('1234123412341234123412341234123412341234123412341234123412341234'),
      public_signature_key: signatureKeys.publicKey,
      public_encryption_key: encryptionKeys.publicKey,
      user_key_pair: {
        public_encryption_key: makeUint8Array('user pub enc key', tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE),
        encrypted_private_encryption_key: makeUint8Array('user enc priv key', SEALED_KEY_SIZE),
      },
      is_ghost_device: true,
      revoked: Number.MAX_SAFE_INTEGER,
    };

    expect(() => serializeUserDeviceV3(userDevice)).to.throw();
  });

  describe('serialization of invalid user device', () => {
    let userDevice;

    beforeEach(() => {
      userDevice = {
        last_reset: new Uint8Array(tcrypto.HASH_SIZE),
        ephemeral_public_signature_key: new Uint8Array(tcrypto.SIGNATURE_PUBLIC_KEY_SIZE),
        user_id: new Uint8Array(tcrypto.HASH_SIZE),
        delegation_signature: new Uint8Array(tcrypto.SIGNATURE_SIZE),
        public_signature_key: new Uint8Array(tcrypto.SIGNATURE_PUBLIC_KEY_SIZE),
        public_encryption_key: new Uint8Array(tcrypto.SIGNATURE_PUBLIC_KEY_SIZE),
        user_key_pair: {
          public_encryption_key: new Uint8Array(tcrypto.ENCRYPTION_PUBLIC_KEY_SIZE),
          encrypted_private_encryption_key: new Uint8Array(SEALED_KEY_SIZE),
        },
        is_ghost_device: true,
        revoked: Number.MAX_SAFE_INTEGER,
      };
    });
    const fields = [
      'ephemeral_public_signature_key',
      'user_id',
      'delegation_signature',
      'public_signature_key',
      'public_encryption_key',
    ];
    fields.forEach(field => {
      it(`should throw if user device with invalid ${field}`, async () => {
        userDevice[field] = new Uint8Array(0);
        expect(() => serializeUserDeviceV3(userDevice)).to.throw();
      });
    });

    it('should throw if user device with invalid encrypted_private_encryption_key', async () => {
      userDevice.user_key_pair.encrypted_private_encryption_key = new Uint8Array(0);
      expect(() => serializeUserDeviceV3(userDevice)).to.throw();
    });

    it('should throw if user device with invalid public_encryption_key', () => {
      userDevice.user_key_pair.public_encryption_key = new Uint8Array(0);
      expect(() => serializeUserDeviceV3(userDevice)).to.throw();
    });
  });
});
