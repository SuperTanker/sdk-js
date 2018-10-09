// @flow

import { random, tcrypto, aead, utils } from '@tanker/crypto';

import { expect } from '@tanker/chai';

import { errors } from '../index';
import { makeChunkEncryptor, getChunkKeys } from '../Encryption/ChunkEncryptor';
import type { EncryptorInterface } from '../Encryption/Encryptor';
import { concatArrays } from '../Blocks/Serialize';

class FakeEncryptor implements EncryptorInterface {
  keys: { [string]: Uint8Array }

  constructor() {
    this.keys = new Map();
  }

  async encryptData(plaintext) {
    const key = random(tcrypto.SYMMETRIC_KEY_SIZE);
    const ret = await aead.encryptAEADv1(key, plaintext);
    this.keys[utils.toBase64(aead.extractResourceId(ret))] = key;
    return ret;
  }

  async decryptData(encryptedData) {
    const key = this.keys[utils.toBase64(aead.extractResourceId(encryptedData))];
    return aead.decryptAEADv1(key, encryptedData);
  }
}

let fakeEncryptor;
let chunkEncryptor;
let clearText;

describe('ChunkEncryptor', () => {
  beforeEach(async () => {
    fakeEncryptor = new FakeEncryptor();
    chunkEncryptor = await makeChunkEncryptor(fakeEncryptor);
    clearText = 'typing sucks in JS';
  });

  it('should deserialize a seal V3 test vector', async () => {
    const version = new Uint8Array([
      // Version
      0x3
    ]);
    const emptyRangesHeader = new Uint8Array([
      // Size of serialized empty ranges varints (size being a varint too!)
      0x04,
      // First empty range
      0x00, 0x00,
      // Second empty range
      0x03, 0x04,
    ]);
    const key1 = new Uint8Array([
      // Key 1
      0x04, 0x96, 0x60, 0xc5, 0xf3, 0x5e, 0xe0, 0x83, 0xd6, 0xfa, 0x08, 0x8e, 0x8b, 0xb1, 0x5a, 0x96,
      0x9e, 0x9c, 0x27, 0xc1, 0x9c, 0x77, 0xcb, 0x4a, 0xee, 0x6d, 0xf9, 0x11, 0xb8, 0x2f, 0x0e, 0xf3
    ]);
    const key2 = new Uint8Array([
      // Key 2
      0x43, 0x5d, 0x42, 0x2d, 0x9a, 0x75, 0x57, 0xf5, 0xe0, 0x41, 0x81, 0x10, 0x13, 0xe8, 0xba, 0x5b,
      0xf2, 0xc3, 0x47, 0xd5, 0xf7, 0x3f, 0xd5, 0xa2, 0x20, 0x47, 0x1f, 0x04, 0x6a, 0xd6, 0x49, 0xff
    ]);
    const key5 = new Uint8Array([
      // Key 5
      0xb2, 0x9f, 0x32, 0xc7, 0xe6, 0x8e, 0xfd, 0x12, 0x1a, 0xd7, 0x33, 0xd2, 0x2f, 0x41, 0xec, 0x30,
      0x56, 0x97, 0x3a, 0xa4, 0x1e, 0xae, 0xa2, 0x71, 0x8f, 0x94, 0x63, 0xf2, 0x8d, 0x64, 0x9c, 0x86,
    ]);
    const testVector = concatArrays(version, emptyRangesHeader, key1, key2, key5);

    const result: Array<?Uint8Array> = getChunkKeys(testVector);
    expect(result[0]).to.deep.equal(null);
    expect(result[1]).to.deep.equal(key1);
    expect(result[2]).to.deep.equal(key2);
    expect(result[3]).to.deep.equal(null);
    expect(result[4]).to.deep.equal(null);
    expect(result[5]).to.deep.equal(key5);
  });

  it('should return encrypted data when calling encrypt without an index', async () => {
    const chunk = await chunkEncryptor.encrypt(clearText);
    // $FlowIKnow
    const clear = await aead.decryptAEADv1(chunkEncryptor.chunkKeys[0], chunk);

    expect(utils.toString(clear)).to.deep.equal(clearText);
  });

  it('should return encrypted data when calling encrypt with an index', async () => {
    const chunk = await chunkEncryptor.encrypt(clearText, 0);
    // $FlowIKnow
    const clear = await aead.decryptAEADv1(chunkEncryptor.chunkKeys[0], chunk);

    expect(utils.toString(clear)).to.deep.equal(clearText);
  });

  it('should create empty elements when encrypt is called with an index > nb chunks', async () => {
    const chunk = await chunkEncryptor.encrypt(clearText, 3);
    // $FlowIKnow
    const clear = await aead.decryptAEADv1(chunkEncryptor.chunkKeys[3], chunk);

    expect(chunkEncryptor.chunkKeys.length).to.deep.equal(4);
    expect(chunkEncryptor.chunkKeys[0]).to.be.null;
    expect(utils.toString(clear)).to.deep.equal(clearText);
  });

  it('should be possible to decrypt an encrypted chunk with decrypt', async () => {
    const encryptedData = await chunkEncryptor.encrypt(clearText, 0);
    const clear = await chunkEncryptor.decrypt(encryptedData, 0);

    expect(clear).to.deep.equal(clearText);
  });

  it('should throw when trying to decrypt corrupted data', async () => {
    const encryptedData = await chunkEncryptor.encrypt(clearText, 0);
    encryptedData[0] += 1;
    const decryptPromise = chunkEncryptor.decrypt(encryptedData, 0);

    await expect(decryptPromise).to.be.rejectedWith(errors.DecryptFailed);
  });

  it('should remove corresponding indexes when calling remove', async () => {
    await chunkEncryptor.encrypt(clearText, 0);
    await chunkEncryptor.encrypt(clearText, 3);
    const expectedChunkKeys = [chunkEncryptor.chunkKeys[0], null];
    chunkEncryptor.remove([1, 3]);
    expect(chunkEncryptor.chunkKeys).to.deep.equal(expectedChunkKeys);
  });

  it('should throw when trying to decrypt a chunk out of range', async () => {
    const encryptedData = await chunkEncryptor.encrypt(clearText);
    await expect(chunkEncryptor.decrypt(encryptedData, 42)).to.be.rejectedWith(errors.ChunkIndexOutOfRange);
    await expect(chunkEncryptor.decrypt(encryptedData, -1)).to.be.rejectedWith(errors.ChunkIndexOutOfRange);
  });

  it('should throw when trying to decrypt a missing chunk', async () => {
    const encryptedData = await chunkEncryptor.encrypt(clearText, 1);
    await expect(chunkEncryptor.decrypt(encryptedData, 0)).to.be.rejectedWith(errors.ChunkNotFound);
  });

  it('should return the number of chunks when accessing length', async () => {
    await chunkEncryptor.encrypt(clearText);
    await chunkEncryptor.encrypt(clearText);
    await chunkEncryptor.encrypt(clearText);

    expect(chunkEncryptor).to.have.a.lengthOf(3);
  });

  it('should be possible to create an ChunkEncryptor with an existing seal', async () => {
    await chunkEncryptor.encrypt(clearText, 0);
    await chunkEncryptor.encrypt(clearText, 4);
    await chunkEncryptor.encrypt(clearText, 5);
    await chunkEncryptor.encrypt(clearText, 7);
    await chunkEncryptor.encrypt(clearText, 11);
    const seal = await chunkEncryptor.seal();
    const newEnc = await makeChunkEncryptor(fakeEncryptor, seal);
    expect(newEnc).to.deep.equal(chunkEncryptor);
  });

  it('should throw when trying to create an ChunkEncryptor with a corrupted seal', async () => {
    await chunkEncryptor.encrypt(clearText, 0);
    await chunkEncryptor.encrypt(clearText, 4);
    await chunkEncryptor.encrypt(clearText, 5);
    await chunkEncryptor.encrypt(clearText, 7);
    await chunkEncryptor.encrypt(clearText, 11);
    const seal = await chunkEncryptor.seal();

    const decryptedSeal = await fakeEncryptor.decryptData(seal);
    const arr = Array.from(decryptedSeal);
    arr.splice(5, 1);
    const encCorruptedSeal = await fakeEncryptor.encryptData(new Uint8Array(arr));

    await expect(makeChunkEncryptor(fakeEncryptor, encCorruptedSeal))
      .to.be.rejectedWith(errors.InvalidSeal);
  });

  it('should change the resource key each time seal is called', async () => {
    const resourceId = aead.extractResourceId(await chunkEncryptor.seal());
    const oldKey = fakeEncryptor.keys[utils.toBase64(resourceId)];
    const newMac = aead.extractResourceId(await chunkEncryptor.seal());
    const newKey = fakeEncryptor.keys[utils.toBase64(newMac)];

    expect(newKey).to.not.deep.equal(oldKey);
  });

  it('should be possible to modify a previous chunk', async () => {
    await chunkEncryptor.encrypt(clearText, 0);
    const previousKey = chunkEncryptor.chunkKeys[0];
    const newText = 'I love C++';
    await chunkEncryptor.encrypt(newText, 0);
    const newKey = chunkEncryptor.chunkKeys[0];

    expect(chunkEncryptor.chunkKeys).to.have.a.lengthOf(1);
    expect(newKey).to.not.deep.equal(previousKey);
  });

  describe('ChunkEncryptor public API type checks', () => {
    const notStringTypes = [undefined, null, 0, {}, [], new Uint8Array(0)];
    const notUint8ArrayTypes = [undefined, null, 0, {}, [], 'wat'];
    const notNumberTypes = [undefined, null, {}, [], 'wat', new Uint8Array(0)];

    it('should throw when calling encrypt() with the wrong types', async () => {
      const notNumberNotUndefTypes = [null, {}, [], 'wat', new Uint8Array(0)];
      // $FlowExpectedError
      await Promise.all(notStringTypes.map(fail => expect(chunkEncryptor.encrypt(fail)).to.be.rejectedWith(errors.InvalidArgument)));
      // $FlowExpectedError
      await Promise.all(notNumberNotUndefTypes.map(fail => expect(chunkEncryptor.encrypt('', fail)).to.be.rejectedWith(errors.InvalidArgument)));
    });

    it('should throw when calling decrypt() with the wrong types', async () => {
      // Warning: not testing decrypt(number, Uint8Array) which is deprecated signature since 1.6.0 (but still valid)
      const notStringOrUint8ArrayTypes = [undefined, null, {}, [], 'wat'];
      // $FlowExpectedError
      await Promise.all(notStringOrUint8ArrayTypes.map(fail => expect(chunkEncryptor.decrypt(new Uint8Array(0), fail)).to.be.rejectedWith(errors.InvalidArgument)));
      // $FlowExpectedError
      await Promise.all(notStringOrUint8ArrayTypes.map(fail => expect(chunkEncryptor.decrypt(fail, 0)).to.be.rejectedWith(errors.InvalidArgument)));
    });

    it('should throw when calling decryptData() with the wrong types', async () => {
      // Warning: not testing decryptData(number, Uint8Array) which is deprecated signature since 1.6.0 (but still valid)
      const notStringOrUint8ArrayTypes = [undefined, null, {}, [], 'wat'];
      // $FlowExpectedError
      await Promise.all(notStringOrUint8ArrayTypes.map(fail => expect(chunkEncryptor.decryptData(fail, 0)).to.be.rejectedWith(errors.InvalidArgument)));
      // $FlowExpectedError
      await Promise.all(notStringOrUint8ArrayTypes.map(fail => expect(chunkEncryptor.decryptData(new Uint8Array(0), fail)).to.be.rejectedWith(errors.InvalidArgument)));
    });

    describe('Deprecated methods in 1.6.0', () => {
      it('should throw when callin encryptReplace() with the wrong types', async () => {
        // $FlowExpectedError
        await Promise.all(notNumberTypes.map(fail => expect(chunkEncryptor.encryptReplace(fail, '')).to.be.rejectedWith(errors.InvalidArgument)));
        // $FlowExpectedError
        await Promise.all(notStringTypes.map(fail => expect(chunkEncryptor.encryptReplace(0, fail)).to.be.rejectedWith(errors.InvalidArgument)));
      });

      it('should throw when calling encryptAppendData() with the wrong type', async () => {
        // $FlowExpectedError
        await Promise.all(notUint8ArrayTypes.map(fail => expect(chunkEncryptor.encryptAppendData(fail)).to.be.rejectedWith(errors.InvalidArgument)));
      });

      it('should throw when calling encryptReplaceData() with the wrong types', async () => {
        // $FlowExpectedError
        await Promise.all(notNumberTypes.map(fail => expect(chunkEncryptor.encryptReplaceData(fail, new Uint8Array(0))).to.be.rejectedWith(errors.InvalidArgument)));

        await chunkEncryptor.encryptAt(0, clearText);
        // $FlowExpectedError
        await Promise.all(notUint8ArrayTypes.map(fail => expect(chunkEncryptor.encryptReplaceData(0, fail)).to.be.rejectedWith(errors.InvalidArgument)));
      });
    });
  });

  describe('Compat of deprecated methods in 1.6.0', () => {
    it('should be possible to call deprecated encryptAppend()', async () => {
      const data = [
        await chunkEncryptor.encryptAppend(clearText),
        await chunkEncryptor.encryptAppend(clearText)
      ];

      expect(data.map(d => d.index)).to.deep.equal([0, 1]);

      const clear = [
        await chunkEncryptor.decrypt(data[0].encryptedData, 0),
        await chunkEncryptor.decrypt(data[1].encryptedData, 1)
      ];

      expect(clear).to.deep.equal([clearText, clearText]);
    });

    it('should be possible to call deprecated encryptAt()', async () => {
      const encryptedData = await chunkEncryptor.encryptAt(1, clearText);
      const clear = await chunkEncryptor.decrypt(encryptedData, 1);
      expect(clear).to.deep.equal(clearText);
    });

    it('should be possible to call deprecated encryptReplace()', async () => {
      await chunkEncryptor.encryptAt(1, 'Whatever');
      const encryptedData = await chunkEncryptor.encryptReplace(1, clearText);
      const clear = await chunkEncryptor.decrypt(encryptedData, 1);
      expect(clear).to.deep.equal(clearText);
    });

    it('should be possible to use depreacted API of decrypt()', async () => {
      const encryptedData = await chunkEncryptor.encrypt(clearText, 1);
      const clear = await chunkEncryptor.decrypt(1, encryptedData);
      expect(clear).to.deep.equal(clearText);
    });

    it('should set corresponding chunk keys to null when calling deprecated erase()', async () => {
      await chunkEncryptor.encrypt(clearText, 0);
      await chunkEncryptor.encrypt(clearText, 3);
      const expectedChunkKeys = [chunkEncryptor.chunkKeys[0], null, null, null];
      chunkEncryptor.erase([1, 3]);
      expect(chunkEncryptor.chunkKeys).to.deep.equal(expectedChunkKeys);
    });
  });
});
