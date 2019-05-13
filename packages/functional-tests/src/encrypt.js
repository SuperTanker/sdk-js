// @flow
import { errors } from '@tanker/core';
import { tcrypto, utils } from '@tanker/crypto';
import { createProvisionalIdentity, getPublicIdentity } from '@tanker/identity';
import FilePonyfill from '@tanker/file-ponyfill';
import { expect, expectRejectedWithProperty } from './chai';

import { type TestArgs } from './TestArgs';

const getConstructor = instance => {
  if (instance instanceof ArrayBuffer)
    return ArrayBuffer;
  if (global.Buffer && instance instanceof Buffer)
    return Buffer;
  else if (instance instanceof Uint8Array)
    return Uint8Array;
  else if (global.File && instance instanceof File || instance instanceof FilePonyfill) // must be before Blob
    return File;
  // else if (global.Blob && instance instanceof Blob)
  return Blob;
};

const getConstructorName = (constructor: Object): string => {
  if (constructor === ArrayBuffer)
    return 'ArrayBuffer';
  if (global.Buffer && constructor === Buffer)
    return 'Buffer';
  else if (constructor === Uint8Array)
    return 'Uint8Array';
  else if (global.File && constructor === File || constructor === FilePonyfill) // must be before Blob
    return 'File';
  // else if (global.Blob && constructor === Blob)
  return 'Blob';
};

const generateEncryptTests = (args: TestArgs) => {
  const clearText: string = 'Rivest Shamir Adleman';
  describe('text resource encryption and sharing - no session', () => {
    let bobLaptop;

    before(() => { bobLaptop = args.makeTanker(); });

    it('throws when using a session in an invalid state', async () => {
      await expect(bobLaptop.encrypt(clearText)).to.be.rejectedWith(errors.InvalidSessionStatus);
    });

    it('throws when decrypting using a session in an invalid state', async () => {
      await expect(bobLaptop.decrypt(utils.fromString('test'))).to.be.rejectedWith(errors.InvalidSessionStatus);
    });
  });

  describe('text resource encryption and sharing', () => {
    let aliceLaptop;
    let aliceIdentity;
    let alicePublicIdentity;
    let bobLaptop;
    let bobIdentity;
    let bobPublicIdentity;

    before(async () => {
      aliceIdentity = await args.trustchainHelper.generateIdentity();
      alicePublicIdentity = await getPublicIdentity(aliceIdentity);
      bobIdentity = await args.trustchainHelper.generateIdentity();
      bobPublicIdentity = await getPublicIdentity(bobIdentity);
      aliceLaptop = args.makeTanker();
      bobLaptop = args.makeTanker();
      await aliceLaptop.start(aliceIdentity);
      await aliceLaptop.registerIdentity({ passphrase: 'passphrase' });
      await bobLaptop.start(bobIdentity);
      await bobLaptop.registerIdentity({ passphrase: 'passphrase' });
    });

    after(async () => {
      await Promise.all([
        aliceLaptop.stop(),
        bobLaptop.stop(),
      ]);
    });

    describe('encrypt and decrypt a text resource', () => {
      it('throws when calling encrypt of undefined', async () => {
        // $FlowExpectedError Testing invalid argument
        await expect(bobLaptop.encrypt()).to.be.rejectedWith(errors.InvalidArgument);
      });

      it('throws when decrypting an invalid type', async () => {
        const notUint8ArrayTypes = [undefined, null, 0, {}, [], 'str'];
        for (let i = 0; i < notUint8ArrayTypes.length; i++) {
          // $FlowExpectedError Testing invalid types
          await expect(bobLaptop.decrypt(notUint8ArrayTypes[i]), `bad decryption #${i}`).to.be.rejectedWith(errors.InvalidArgument);
        }
      });

      it('throws when decrypting data with an unknow encryption format', async () => {
        const invalidEncrypted = new Uint8Array([127]);
        await expect(bobLaptop.decrypt(invalidEncrypted)).to.be.rejectedWith(errors.InvalidEncryptionFormat);
      });

      it('throws when decrypting data with an invalid encryption format', async () => {
        const invalidEncrypted = new Uint8Array([255]); // not a varint
        await expect(bobLaptop.decrypt(invalidEncrypted)).to.be.rejectedWith(errors.InvalidEncryptionFormat);
      });

      it('throws when decrypting truncated encrypted resource', async () => {
        const encrypted = await bobLaptop.encrypt(clearText);
        // shorter than version + resource ID: should not even try to decrypt
        const invalidEncrypted = encrypted.subarray(0, tcrypto.MAC_SIZE - 4);
        await expect(bobLaptop.decrypt(invalidEncrypted)).to.be.rejectedWith(errors.InvalidArgument);
      });

      it('throws when calling decrypt with a corrupted buffer (resource id)', async () => {
        const encrypted = await bobLaptop.encrypt(clearText);
        const corruptPos = encrypted.length - 4;
        encrypted[corruptPos] = (encrypted[corruptPos] + 1) % 256;
        await expect(bobLaptop.decrypt(encrypted)).to.be.rejectedWith(errors.ResourceNotFound);
      });

      it('throws when calling decrypt with a corrupted buffer (data)', async () => {
        const encrypted = await bobLaptop.encrypt(clearText);
        const corruptPos = 4;
        encrypted[corruptPos] = (encrypted[corruptPos] + 1) % 256;
        await expect(bobLaptop.decrypt(encrypted)).to.be.rejectedWith(errors.DecryptFailed);
      });

      it('can encrypt and decrypt a text resource', async () => {
        const encrypted = await bobLaptop.encrypt(clearText);
        const decrypted = await bobLaptop.decrypt(encrypted);
        expect(decrypted).to.equal(clearText);
      });

      describe('share at encryption time', () => {
        it('shares with the recipient', async () => {
          const encrypted = await bobLaptop.encrypt(clearText, { shareWithUsers: [alicePublicIdentity] });
          const decrypted = await aliceLaptop.decrypt(encrypted);
          expect(decrypted).to.equal(clearText);
        });

        it('throws when sharing with secret permanent identities', async () => {
          await expect(bobLaptop.encrypt(clearText, { shareWithUsers: [aliceIdentity] })).to.be.rejectedWith(errors.InvalidArgument);
        });

        it('throws when sharing with secret provisional identities', async () => {
          const email = 'alice@tanker-functional-test.io';
          const provisionalIdentity = await createProvisionalIdentity(utils.toBase64(args.trustchainHelper.trustchainId), email);
          await expect(bobLaptop.encrypt(clearText, { shareWithUsers: [provisionalIdentity] })).to.be.rejectedWith(errors.InvalidArgument);
        });

        it('encrypt and share with provisional users', async () => {
          const email = 'alice@tanker-functional-test.io';
          const provisionalIdentity = await createProvisionalIdentity(utils.toBase64(args.trustchainHelper.trustchainId), email);
          const publicProvisionalIdentity = await getPublicIdentity(provisionalIdentity);
          await expect(bobLaptop.encrypt(clearText, { shareWithUsers: [publicProvisionalIdentity] })).to.be.fulfilled;
        });

        it('cannot claim without share', async () => {
          const email = 'unique@tanker-functional-test.io';
          const provisionalIdentity = await createProvisionalIdentity(utils.toBase64(args.trustchainHelper.trustchainId), email);

          const verificationCode = await args.trustchainHelper.getVerificationCode(email);
          await expect(aliceLaptop.claimProvisionalIdentity(provisionalIdentity, verificationCode)).to.be.rejectedWith(errors.NothingToClaim);
        });

        it('claim provisionalIdentity blocks', async () => {
          const email = 'alice@tanker-functional-test.io';
          const provisionalIdentity = await createProvisionalIdentity(utils.toBase64(args.trustchainHelper.trustchainId), email);
          const publicProvisionalIdentity = await getPublicIdentity(provisionalIdentity);
          await bobLaptop.encrypt(clearText, { shareWithUsers: [publicProvisionalIdentity] });

          const verificationCode = await args.trustchainHelper.getVerificationCode(email);
          await expect(aliceLaptop.claimProvisionalIdentity(provisionalIdentity, verificationCode)).to.be.fulfilled;
        });

        it('decrypt claimed block', async () => {
          const email = 'alice@tanker-functional-test.io';
          const provisionalIdentity = await createProvisionalIdentity(utils.toBase64(args.trustchainHelper.trustchainId), email);
          const publicProvisionalIdentity = await getPublicIdentity(provisionalIdentity);
          const cipherText = await bobLaptop.encrypt(clearText, { shareWithUsers: [publicProvisionalIdentity] });

          const verificationCode = await args.trustchainHelper.getVerificationCode(email);
          await aliceLaptop.claimProvisionalIdentity(provisionalIdentity, verificationCode);
          const decrypted = await aliceLaptop.decrypt(cipherText);
          expect(decrypted).to.equal(clearText);
        });

        it('decrypt claimed block after stop and start again', async () => {
          const email = 'alice@tanker-functional-test.io';
          const provisionalIdentity = await createProvisionalIdentity(utils.toBase64(args.trustchainHelper.trustchainId), email);
          const publicProvisionalIdentity = await getPublicIdentity(provisionalIdentity);
          const verificationCode = await args.trustchainHelper.getVerificationCode(email);
          const cipherText = await bobLaptop.encrypt(clearText, { shareWithUsers: [publicProvisionalIdentity] });
          await aliceLaptop.claimProvisionalIdentity(provisionalIdentity, verificationCode);
          await aliceLaptop.stop();
          await aliceLaptop.start(aliceIdentity);
          const decrypted = await aliceLaptop.decrypt(cipherText);
          expect(decrypted).to.equal(clearText);
        });

        it('throws when sharing with already claimed identity', async () => {
          const email = 'alice@tanker-functional-test.io';
          const provisionalIdentity = await createProvisionalIdentity(utils.toBase64(args.trustchainHelper.trustchainId), email);
          const publicProvisionalIdentity = await getPublicIdentity(provisionalIdentity);

          await bobLaptop.encrypt(clearText, { shareWithUsers: [publicProvisionalIdentity] });
          const verificationCode = await args.trustchainHelper.getVerificationCode(email);
          await aliceLaptop.claimProvisionalIdentity(provisionalIdentity, verificationCode);
          await expect(bobLaptop.encrypt(clearText, { shareWithUsers: [publicProvisionalIdentity] })).to.be.rejectedWith(errors.ServerError);
        });

        it('throws when claiming twice the same identity', async () => {
          const email = 'alice@tanker-functional-test.io';
          const provisionalIdentity = await createProvisionalIdentity(utils.toBase64(args.trustchainHelper.trustchainId), email);
          const publicProvisionalIdentity = await getPublicIdentity(provisionalIdentity);
          await bobLaptop.encrypt(clearText, { shareWithUsers: [publicProvisionalIdentity] });
          let verificationCode = await args.trustchainHelper.getVerificationCode(email);
          await aliceLaptop.claimProvisionalIdentity(provisionalIdentity, verificationCode);

          verificationCode = await args.trustchainHelper.getVerificationCode(email);
          await expect(aliceLaptop.claimProvisionalIdentity(provisionalIdentity, verificationCode)).to.be.rejectedWith(errors.ServerError);
        });

        it('throws when claiming with wrong verification code', async () => {
          const email = 'alice@tanker-functional-test.io';
          const provisionalIdentity = await createProvisionalIdentity(utils.toBase64(args.trustchainHelper.trustchainId), email);
          const publicProvisionalIdentity = await getPublicIdentity(provisionalIdentity);
          await bobLaptop.encrypt(clearText, { shareWithUsers: [publicProvisionalIdentity] });

          await expect(aliceLaptop.claimProvisionalIdentity(provisionalIdentity, 'wrongCode')).to.be.rejectedWith(errors.InvalidVerificationCode);
        });

        it('throw when two Users claim same provisional identity', async () => {
          const email = 'alice@tanker-functional-test.io';
          const provisionalIdentity = await createProvisionalIdentity(utils.toBase64(args.trustchainHelper.trustchainId), email);
          const publicProvisionalIdentity = await getPublicIdentity(provisionalIdentity);
          await bobLaptop.encrypt(clearText, { shareWithUsers: [publicProvisionalIdentity] });
          let verificationCode = await args.trustchainHelper.getVerificationCode(email);
          await aliceLaptop.claimProvisionalIdentity(provisionalIdentity, verificationCode);

          verificationCode = await args.trustchainHelper.getVerificationCode(email);
          await expect(bobLaptop.claimProvisionalIdentity(provisionalIdentity, verificationCode)).to.be.rejectedWith(errors.ServerError);
        });

        it('decrypt claimed block on a new device', async () => {
          const email = 'alice@tanker-functional-test.io';
          const provisionalIdentity = await createProvisionalIdentity(utils.toBase64(args.trustchainHelper.trustchainId), email);
          const publicProvisionalIdentity = await getPublicIdentity(provisionalIdentity);

          const cipherText = await aliceLaptop.encrypt(clearText, { shareWithUsers: [publicProvisionalIdentity] });

          const verificationCode = await args.trustchainHelper.getVerificationCode(email);
          await bobLaptop.claimProvisionalIdentity(provisionalIdentity, verificationCode);

          const bobPhone = args.makeTanker();
          await bobPhone.start(bobIdentity);
          await bobPhone.verifyIdentity({ passphrase: 'passphrase' });
          const decrypted = await bobPhone.decrypt(cipherText);
          expect(decrypted).to.equal(clearText);
        });

        it('throws when sharing with a user that does not exist', async () => {
          const eveIdentity = await getPublicIdentity(await args.trustchainHelper.generateIdentity('eve'));

          await expectRejectedWithProperty({
            handler: async () => bobLaptop.encrypt(clearText, { shareWithUsers: [eveIdentity] }),
            exception: errors.RecipientsNotFound,
            property: 'recipientIds',
            expectedValue: [eveIdentity]
          });
        });

        it('shares even when the recipient is not connected', async () => {
          await aliceLaptop.stop();
          const encrypted = await bobLaptop.encrypt(clearText, { shareWithUsers: [alicePublicIdentity] });

          await aliceLaptop.start(aliceIdentity);
          const decrypted = await aliceLaptop.decrypt(encrypted);
          expect(decrypted).to.equal(clearText);
        });

        it('shares with a device created after sharing', async () => {
          const encrypted = await aliceLaptop.encrypt(clearText, { shareWithUsers: [bobPublicIdentity] });
          const bobPhone = args.makeTanker();
          await bobPhone.start(bobIdentity);
          await bobPhone.verifyIdentity({ passphrase: 'passphrase' });

          const decrypted = await bobPhone.decrypt(encrypted);
          expect(decrypted).to.equal(clearText);
          await bobPhone.stop();
        });
      });
    });

    describe('share after encryption (reshare)', () => {
      it('throws when sharing an invalid resource id', async () => {
        // $FlowExpectedError
        await expect(bobLaptop.share(null, { shareWithUsers: [alicePublicIdentity] })).to.be.rejectedWith(errors.InvalidArgument);
      });

      it('throws when sharing with an invalid recipient list', async () => {
        const encrypted = await bobLaptop.encrypt(clearText);
        const resourceId = await bobLaptop.getResourceId(encrypted);
        // $FlowExpectedError
        await expect(bobLaptop.share([resourceId])).to.be.rejectedWith(errors.InvalidArgument);
      });

      it('throws when sharing a resource that doesn\'t exist', async () => {
        const badResourceId = 'AAAAAAAAAAAAAAAAAAAAAA==';

        await expectRejectedWithProperty({
          handler: async () => bobLaptop.share([badResourceId], { shareWithUsers: [alicePublicIdentity] }),
          exception: errors.ResourceNotFound,
          property: 'b64ResourceId',
          expectedValue: badResourceId
        });
      });

      it('throws when sharing with a user that doesn\'t exist', async () => {
        const edata = await bobLaptop.encrypt(clearText);
        const resourceId = await bobLaptop.getResourceId(edata);
        const eveIdentity = await getPublicIdentity(await args.trustchainHelper.generateIdentity('eve'));

        await expectRejectedWithProperty({
          handler: async () => bobLaptop.share([resourceId], { shareWithUsers: [eveIdentity] }),
          exception: errors.RecipientsNotFound,
          property: 'recipientIds',
          expectedValue: [eveIdentity]
        });
      });

      it('shares an existing resource with an existing User', async () => {
        const encrypted = await bobLaptop.encrypt(clearText);
        const resourceId = await bobLaptop.getResourceId(encrypted);
        await bobLaptop.share([resourceId], { shareWithUsers: [alicePublicIdentity] });

        const decrypted = await aliceLaptop.decrypt(encrypted);
        expect(decrypted).to.equal(clearText);
      });

      it('shares an existing resource with a provisional User', async () => {
        const email = 'alice@tanker-functional-test.io';
        const provisionalIdentity = await createProvisionalIdentity(utils.toBase64(args.trustchainHelper.trustchainId), email);
        const publicProvisionalIdentity = await getPublicIdentity(provisionalIdentity);
        const cipherText = await bobLaptop.encrypt(clearText);
        const resourceId = await bobLaptop.getResourceId(cipherText);
        await expect(bobLaptop.share([resourceId], { shareWithUsers: [publicProvisionalIdentity] })).to.be.fulfilled;
      });
    });
  });

  describe('text resource encryption and sharing with multiple devices', () => {
    let aliceLaptop;
    let aliceIdentity;
    let bobLaptop;
    let bobPhone;
    let bobIdentity;

    beforeEach(async () => {
      aliceIdentity = await args.trustchainHelper.generateIdentity();
      bobIdentity = await args.trustchainHelper.generateIdentity();
      aliceLaptop = args.makeTanker();
      bobLaptop = args.makeTanker();
      bobPhone = args.makeTanker();
      await aliceLaptop.start(aliceIdentity);
      await aliceLaptop.registerIdentity({ passphrase: 'passphrase' });

      await bobLaptop.start(bobIdentity);
      await bobLaptop.registerIdentity({ passphrase: 'passphrase' });
      await bobPhone.start(bobIdentity);
      await bobPhone.verifyIdentity({ passphrase: 'passphrase' });
    });

    afterEach(async () => {
      await Promise.all([
        bobPhone.stop(),
        bobLaptop.stop(),
        aliceLaptop.stop(),
      ]);
    });

    it('can decrypt a resource encrypted from another device', async () => {
      const encrypted = await bobLaptop.encrypt(clearText);
      const decrypted = await bobPhone.decrypt(encrypted);
      expect(decrypted).to.equal(clearText);
    });

    it('can access a resource encrypted and shared from a device that was then revoked', async () => {
      const encrypted = await bobLaptop.encrypt(clearText);

      // revoke bobLaptop
      await bobPhone.revokeDevice(bobLaptop.deviceId);

      const decrypted = await bobPhone.decrypt(encrypted);
      expect(decrypted).to.equal(clearText);
    });
  });

  // A few helpers needed to test binary resources:
  const objectType = (obj: Object) => {
    const type = getConstructor(obj);
    return type === 'FilePonyfill' ? File : type;
  };
  // In Edge and IE11, accessing the webkitRelativePath property (though defined) triggers
  // a TypeError: Invalid calling object. We avoid this by comparing only useful props.
  const fileProps = (obj: Object) => {
    const { name, size, type, lastModified } = obj;
    return { name, size, type, lastModified };
  };
  const expectType = (obj: Object, type: Object) => expect(objectType(obj)).to.equal(type);
  const expectSameType = (a: Object, b: Object) => expect(objectType(a)).to.equal(objectType(b));
  const expectDeepEqual = (a: Object, b: Object) => {
    if (global.File && a instanceof File) {
      expect(fileProps(a)).to.deep.equal(fileProps(b));
      return;
    }
    expect(a).to.deep.equal(b);
  };

  const sizes = Object.keys(args.resources);

  sizes.forEach(size => {
    describe(`${size} binary resource encryption`, () => {
      let aliceLaptop;
      let aliceIdentity;

      before(async () => {
        aliceIdentity = await args.trustchainHelper.generateIdentity();
        aliceLaptop = args.makeTanker();
        await aliceLaptop.start(aliceIdentity);
        await aliceLaptop.registerIdentity({ passphrase: 'passphrase' });
      });

      after(async () => {
        await aliceLaptop.stop();
      });

      args.resources[size].forEach(({ type, resource: clear }) => {
        it(`can encrypt and decrypt keeping input type (${getConstructorName(type)}) by default`, async () => {
          const encrypted = await aliceLaptop.encryptData(clear);
          expectSameType(encrypted, clear);

          const decrypted = await aliceLaptop.decryptData(encrypted);
          expectSameType(decrypted, clear);

          expectDeepEqual(decrypted, clear);
        });
      });

      // Type conversions have already been tested with medium resources, so skip for big ones.
      if (size === 'big') return;

      args.resources[size].forEach(({ type: originalType, resource: clear }) => {
        args.resources[size].forEach(({ type: transientType }) => {
          it(`can encrypt a ${getConstructorName(originalType)} into a ${getConstructorName(transientType)} and decrypt back a ${getConstructorName(originalType)}`, async () => {
            const encrypted = await aliceLaptop.encryptData(clear, { type: transientType });
            expectType(encrypted, transientType);

            const outputOptions = {};
            outputOptions.type = originalType;

            if (global.Blob && outputOptions.type === Blob) {
              outputOptions.mime = clear.type;
            }
            if (global.File && outputOptions.type === File) {
              outputOptions.mime = clear.type;
              outputOptions.name = clear.name;
              outputOptions.lastModified = clear.lastModified;
            }

            const decrypted = await aliceLaptop.decryptData(encrypted, outputOptions);
            expectType(decrypted, originalType);

            expectDeepEqual(decrypted, clear);
          });
        });
      });
    });
  });
};

export default generateEncryptTests;
