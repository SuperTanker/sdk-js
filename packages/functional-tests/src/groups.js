// @flow
import { errors } from '@tanker/core';
import { utils, tcrypto } from '@tanker/crypto';
import { getPublicIdentity } from '@tanker/identity';
import { expect, expectRejectedWithProperty } from './chai';
import { type TestArgs } from './TestArgs';

const generateGroupsTests = (args: TestArgs) => {
  describe('groups', () => {
    let alicePublicIdentity;
    let bobPublicIdentity;
    let unknownUsers;
    const message = "Two's company, three's a crowd";

    before(async () => {
      const aliceIdentity = await args.trustchainHelper.generateIdentity();
      alicePublicIdentity = await getPublicIdentity(aliceIdentity);
      await args.aliceLaptop.signUp(aliceIdentity);

      const bobIdentity = await args.trustchainHelper.generateIdentity();
      bobPublicIdentity = await getPublicIdentity(bobIdentity);
      await args.bobLaptop.signUp(bobIdentity);

      unknownUsers = [await getPublicIdentity(await args.trustchainHelper.generateIdentity('galette'))];
    });

    after(async () => {
      await Promise.all([
        args.aliceLaptop.signOut(),
        args.bobLaptop.signOut(),
        args.bobPhone.signOut(),
      ]);
    });

    it('should create a group', async () => {
      await args.bobLaptop.createGroup([alicePublicIdentity, bobPublicIdentity]);
    });

    it('should add a member to a group', async () => {
      const groupId = await args.bobLaptop.createGroup([alicePublicIdentity]);
      await expect(args.aliceLaptop.updateGroupMembers(groupId, { usersToAdd: [bobPublicIdentity] })).to.be.fulfilled;
    });

    it('should add a member to a group twice', async () => {
      const groupId = await args.bobLaptop.createGroup([alicePublicIdentity]);
      await expect(args.aliceLaptop.updateGroupMembers(groupId, { usersToAdd: [bobPublicIdentity] })).to.be.fulfilled;
      await expect(args.aliceLaptop.updateGroupMembers(groupId, { usersToAdd: [bobPublicIdentity] })).to.be.fulfilled;
    });

    it('throws on groupCreation with invalid user', async () => {
      await expectRejectedWithProperty({
        handler: async () => args.aliceLaptop.createGroup([alicePublicIdentity, ...unknownUsers]),
        exception: errors.RecipientsNotFound,
        property: 'recipientIds',
        expectedValue: unknownUsers
      });
    });

    it('throws on groupUpdate with invalid users', async () => {
      const groupId = await args.aliceLaptop.createGroup([alicePublicIdentity]);

      await expectRejectedWithProperty({
        handler: async () => args.aliceLaptop.updateGroupMembers(groupId, { usersToAdd: unknownUsers }),
        exception: errors.RecipientsNotFound,
        property: 'recipientIds',
        expectedValue: unknownUsers
      });
    });

    it('throws on groupUpdate with mix valid/invalid users', async () => {
      const groupId = await args.aliceLaptop.createGroup([alicePublicIdentity]);

      await expectRejectedWithProperty({
        handler: async () => args.aliceLaptop.updateGroupMembers(groupId, { usersToAdd: [bobPublicIdentity, ...unknownUsers] }),
        exception: errors.RecipientsNotFound,
        property: 'recipientIds',
        expectedValue: unknownUsers
      });
    });

    it('throws on groupCreation with empty users', async () => {
      await expect(args.aliceLaptop.createGroup([]))
        .to.be.rejectedWith(errors.InvalidGroupSize);
    });

    it('throws on groupUpdate with empty users', async () => {
      const groupId = await args.aliceLaptop.createGroup([alicePublicIdentity]);

      await expect(args.aliceLaptop.updateGroupMembers(groupId, { usersToAdd: [] }))
        .to.be.rejectedWith(errors.InvalidGroupSize);
    });

    it('should publish keys to group', async () => {
      const groupId = await args.bobLaptop.createGroup([alicePublicIdentity, bobPublicIdentity]);

      const encrypted = await args.bobLaptop.encrypt(message, { shareWithGroups: [groupId] });
      const decrypted = await args.aliceLaptop.decrypt(encrypted);
      expect(decrypted).to.equal(message);
    });

    it('should publish keys to non-local group', async () => {
      const groupId = await args.aliceLaptop.createGroup([alicePublicIdentity]);

      const encrypted = await args.bobLaptop.encrypt(message, { shareWithGroups: [groupId] });
      const decrypted = await args.aliceLaptop.decrypt(encrypted);
      expect(decrypted).to.equal(message);
    });

    it('should share keys to group', async () => {
      const groupId = await args.aliceLaptop.createGroup([alicePublicIdentity]);

      const encrypted = await args.bobLaptop.encrypt(message);
      const resourceId = await args.bobLaptop.getResourceId(encrypted);
      await args.bobLaptop.share([resourceId], { shareWithGroups: [groupId] });

      const decrypted = await args.aliceLaptop.decrypt(encrypted);
      expect(decrypted).to.equal(message);
    });

    it('should publish keys to updated group', async () => {
      const groupId = await args.aliceLaptop.createGroup([alicePublicIdentity]);
      await args.aliceLaptop.updateGroupMembers(groupId, { usersToAdd: [bobPublicIdentity] });

      const encrypted = await args.aliceLaptop.encrypt(message, { shareWithGroups: [groupId] });
      const decrypted = await args.bobLaptop.decrypt(encrypted);
      expect(decrypted).to.equal(message);
    });

    it('should publish old keys to new group member', async () => {
      const groupId = await args.aliceLaptop.createGroup([alicePublicIdentity]);
      const encrypted = await args.aliceLaptop.encrypt(message, { shareWithGroups: [groupId] });
      await expect(args.bobLaptop.decrypt(encrypted)).to.be.rejectedWith(errors.ResourceNotFound);
      await args.aliceLaptop.updateGroupMembers(groupId, { usersToAdd: [bobPublicIdentity] });

      const decrypted = await args.bobLaptop.decrypt(encrypted);
      expect(decrypted).to.equal(message);
    });

    it('should not be able to update a group you are not in', async () => {
      const groupId = await args.aliceLaptop.createGroup([alicePublicIdentity]);
      await expect(args.bobLaptop.updateGroupMembers(groupId, { usersToAdd: [bobPublicIdentity] }))
        .to.be.rejectedWith(errors.InvalidArgument);
    });

    it('create a group with a provisional user', async () => {
      const email = 'alice@tanker-functional-test.io';
      const sigKeyPair = tcrypto.makeSignKeyPair();
      const encKeyPair = tcrypto.makeEncryptionKeyPair();

      const provisionalIdentity = utils.toB64Json({
        trustchain_id: utils.toBase64(args.trustchainHelper.trustchainId),
        target: 'email',
        value: email,
        public_signature_key: utils.toBase64(sigKeyPair.publicKey),
        public_encryption_key: utils.toBase64(encKeyPair.publicKey),
      });

      const groupId = await args.bobLaptop.createGroup([provisionalIdentity]);
      const encrypted = await args.bobLaptop.encrypt(message, { shareWithGroups: [groupId] });

      const verificationCode = await args.trustchainHelper.getVerificationCode(email);
      await expect(args.aliceLaptop.provisionalIdentityClaim({ email }, verificationCode, utils.toBase64(sigKeyPair.privateKey), utils.toBase64(encKeyPair.privateKey))).to.be.fulfilled;

      expect(await args.aliceLaptop.decrypt(encrypted)).to.deep.equal(message);
    });

    it('should add a provisional member to a group', async () => {
      const groupId = await args.bobLaptop.createGroup([bobPublicIdentity]);

      const email = 'alice@tanker-functional-test.io';
      const sigKeyPair = tcrypto.makeSignKeyPair();
      const encKeyPair = tcrypto.makeEncryptionKeyPair();

      const provisionalIdentity = utils.toB64Json({
        trustchain_id: utils.toBase64(args.trustchainHelper.trustchainId),
        target: 'email',
        value: email,
        public_signature_key: utils.toBase64(sigKeyPair.publicKey),
        public_encryption_key: utils.toBase64(encKeyPair.publicKey),
      });

      await expect(args.bobLaptop.updateGroupMembers(groupId, { usersToAdd: [provisionalIdentity] })).to.be.fulfilled;
      const encrypted = await args.bobLaptop.encrypt(message, { shareWithGroups: [groupId] });

      const verificationCode = await args.trustchainHelper.getVerificationCode(email);
      await expect(args.aliceLaptop.provisionalIdentityClaim({ email }, verificationCode, utils.toBase64(sigKeyPair.privateKey), utils.toBase64(encKeyPair.privateKey))).to.be.fulfilled;

      expect(await args.aliceLaptop.decrypt(encrypted)).to.deep.equal(message);
    });

    it('should add a provisional member to a group with a premature verification', async () => {
      const groupId = await args.bobLaptop.createGroup([bobPublicIdentity]);

      const email = 'alice@tanker-functional-test.io';
      const sigKeyPair = tcrypto.makeSignKeyPair();
      const encKeyPair = tcrypto.makeEncryptionKeyPair();

      const provisionalIdentity = utils.toB64Json({
        trustchain_id: utils.toBase64(args.trustchainHelper.trustchainId),
        target: 'email',
        value: email,
        public_signature_key: utils.toBase64(sigKeyPair.publicKey),
        public_encryption_key: utils.toBase64(encKeyPair.publicKey),
      });

      await expect(args.bobLaptop.updateGroupMembers(groupId, { usersToAdd: [provisionalIdentity] })).to.be.fulfilled;
      const encrypted = await args.bobLaptop.encrypt(message, { shareWithGroups: [groupId] });

      await args.aliceLaptop.encrypt('stuff', { shareWithGroups: [groupId] });

      const verificationCode = await args.trustchainHelper.getVerificationCode(email);
      await expect(args.aliceLaptop.provisionalIdentityClaim({ email }, verificationCode, utils.toBase64(sigKeyPair.privateKey), utils.toBase64(encKeyPair.privateKey))).to.be.fulfilled;

      expect(await args.aliceLaptop.decrypt(encrypted)).to.deep.equal(message);
    });
  });
};

export default generateGroupsTests;
