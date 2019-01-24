// @flow
import uuid from 'uuid';
import sinon from 'sinon';
import { errors } from '@tanker/core';

import { expect } from './chai';
import { type TestArgs } from './TestArgs';
import { syncTankers } from './Helpers';

const generateRevocationTests = (args: TestArgs) => {
  describe('revocation', () => {
    let bobId;
    let bobToken;

    beforeEach(async () => {
      bobId = uuid.v4();
      bobToken = args.trustchainHelper.generateUserToken(bobId);

      await args.bobLaptop.open(bobId, bobToken);
      const bobUnlockKey = await args.bobLaptop.generateAndRegisterUnlockKey();

      args.bobPhone.once('unlockRequired', async () => {
        args.bobPhone.unlockCurrentDevice({ unlockKey: bobUnlockKey });
      });
      await args.bobPhone.open(bobId, bobToken);
    });

    afterEach(async () => {
      await Promise.all([
        args.aliceLaptop.close(),
        args.bobLaptop.close(),
        args.bobPhone.close(),
      ]);
    });

    const revokeBobPhone = async () => {
      const waitForSelfRevoked = new Promise(resolve => args.bobPhone.once('revoked', resolve));

      await args.bobLaptop.revokeDevice(args.bobPhone.deviceId);
      const waitForRemoteRevoked = args.bobLaptop._session._trustchain.sync([], []); // eslint-disable-line no-underscore-dangle

      await Promise.all([waitForRemoteRevoked, waitForSelfRevoked]);
    };

    const expectRevokedEvent = (opts) => new Promise((resolve, reject) => {
      const device = opts.on;
      device.on('revoked', () => {
        if (opts.to_be_received) {
          resolve();
        } else {
          reject(new Error('A revoked event has been received by an unexpected device'));
        }
      });
    });

    it('fires a revoked event on the revoked device only', async () => {
      const timeoutPromise = (timeout) => new Promise(resolve => setTimeout(resolve, timeout));

      const testPromise = Promise.all([
        expectRevokedEvent({ to_be_received: true, on: args.bobPhone }),
        Promise.race([
          expectRevokedEvent({ to_be_received: false, on: args.bobLaptop }),
          timeoutPromise(1000),
        ])
      ]);

      args.bobLaptop.revokeDevice(args.bobPhone.deviceId);

      await expect(testPromise).to.be.fulfilled;
    });

    it('wipes the storage of the revoked device', async () => {
      const destroy = sinon.spy(args.bobPhone._session.storage, 'nuke'); //eslint-disable-line no-underscore-dangle
      try {
        await revokeBobPhone();
        expect(destroy.calledOnce).to.be.true;
      } finally {
        destroy.restore();
      }
    });

    it('can\'t open a session on a device revoked while closed', async () => {
      const bobPhoneDeviceId = args.bobPhone.deviceId;
      await args.bobPhone.close();
      await args.bobLaptop.revokeDevice(bobPhoneDeviceId);
      const promise = args.bobPhone.open(bobId, bobToken);
      await expect(promise).to.be.rejected;
    });

    // TODO: implement code to make this test pass
    //
    // it('can\'t open a session on a revoked device with datastores not properly destroyed', async () => {
    //   // This can happend when a user closes the browser after receiving the latest
    //   // blocks, but just before the wiping of the dbs (stores and trustchain).

    //   // simulate that the destroys doesn't work in the revocation process
    //   const noDestroy = () => { throw new Error('simulate broken destroy in test'); };
    //   // $FlowIKnow Flow won't allow overriding methods (they are read-only)
    //   args.bobPhone.datastore.destroy = noDestroy;

    //   // wait for args.bobPhone to close (but no revoked event since the revocation failed)
    //   const args.bobPhoneClosed = new Promise(resolve => args.bobPhone.on('sessionClosed', resolve));
    //   await revokeBobPhone({ blockReceivedBy: [args.bobLaptop], revokedEvent: false });
    //   await args.bobPhoneClosed;

    //   // reconnect with datastores that have not been destroyed previously,
    //   // the device should detect its revocation and self destroy now
    //   await args.bobPhone.open(bob.userId, bob.userToken);
    //   expect(args.bobPhone.status).to.eq(args.bobPhone.CLOSED);
    // });

    it('can list a user\'s active and revoked devices', async () => {
      const laptopId = args.bobLaptop.deviceId;
      const phoneId = args.bobPhone.deviceId;

      await revokeBobPhone();

      let devices = await args.bobLaptop.getDeviceList();
      expect(devices.length).to.equal(2);

      // order: laptop first, phone second
      if (devices[0].id === phoneId)
        devices = [devices[1], devices[0]];

      const laptopCandidate = devices[0];
      const phoneCandidate = devices[1];

      expect(laptopCandidate.id).to.equal(laptopId);
      expect(laptopCandidate.isRevoked).to.be.false;

      expect(phoneCandidate.id).to.equal(phoneId);
      expect(phoneCandidate.isRevoked).to.be.true;
    });

    it('can access encrypted resources when having another revoked device', async () => {
      await revokeBobPhone();
      const message = 'test';
      const encrypted = await args.bobLaptop.encrypt(message);
      const clear = await args.bobLaptop.decrypt(encrypted);
      expect(clear).to.eq(message);
    });

    it('Alice can share with Bob who has a revoked device', async () => {
      const aliceId = uuid.v4();
      const aliceToken = args.trustchainHelper.generateUserToken(aliceId);
      await args.aliceLaptop.open(aliceId, aliceToken);

      await revokeBobPhone();

      await syncTankers(args.aliceLaptop, args.bobLaptop);

      const message = 'I love you';
      const encrypted = await args.aliceLaptop.encrypt(message, { shareWithUsers: [bobId] });

      const clear = await args.bobLaptop.decrypt(encrypted);
      expect(clear).to.eq(message);

      await expect(args.bobPhone.decrypt(encrypted)).to.be.rejectedWith(errors.InvalidSessionStatus);
    });
  });
};

export default generateRevocationTests;
