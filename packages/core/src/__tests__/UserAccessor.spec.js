// @flow
import sinon from 'sinon';
import { expect } from '@tanker/chai';

import { utils } from '@tanker/crypto';
import { makeUserStoreBuilder } from './UserStoreBuilder';
import UserAccessor from '../Users/UserAccessor';
import { RecipientsNotFound } from '../errors';
import { makeBuffer } from './utils';

import Trustchain from '../Trustchain/Trustchain';

class StubTrustchain {
  forceSync = () => null;
  updateUserStore = () => null;
  _trustchainStore = {
    _trustchainId: null,
  };
}

async function makeTestUsers({ onUpdateUserStore } = {}) {
  const stubTrustchain = new StubTrustchain();
  const me = makeBuffer('fake author', 32);

  const { builder, generator, userStore } = await makeUserStoreBuilder();
  stubTrustchain._trustchainStore._trustchainId = generator.trustchainId; // eslint-disable-line no-underscore-dangle

  if (onUpdateUserStore)
    stubTrustchain.updateUserStore = onUpdateUserStore({ builder, generator, userStore });

  const stubs = {
    forceSync: sinon.stub(stubTrustchain, 'forceSync'),
    updateUserStore: sinon.stub(stubTrustchain, 'updateUserStore'),
  };

  const trustchain: Trustchain = (stubTrustchain: any);
  const users = new UserAccessor(userStore, trustchain, generator.trustchainId, me);
  // add a user just in case... (can catch bugs)
  await builder.newUserCreationV3('germaine');

  return {
    builder,
    generator,
    userStore,
    users,
    stubTrustchain,
    stubs,
  };
}


describe('Users', () => {
  describe('findUser', () => {
    it('returns a user', async () => {
      const { users, builder } = await makeTestUsers();
      const alice = await builder.newUserCreationV3('alice');
      const user = await users.findUser({ hashedUserId: alice.entry.user_id });

      expect(user && user.userId).to.equal(utils.toBase64(alice.entry.user_id));
    });

    it('fetches a user', async () => {
      const { users, stubs } = await makeTestUsers();
      const hashedBobId = new Uint8Array(32);

      await users.findUser({ hashedUserId: hashedBobId });

      expect(stubs.forceSync.withArgs([hashedBobId]).calledOnce).to.be.true;
      expect(stubs.updateUserStore.withArgs([hashedBobId]).calledOnce).to.be.true;
    });

    it('returns a fetched user', async () => {
      const { users, generator, builder, stubs } = await makeTestUsers();
      const hashedBobId = generator.userId('bob');

      stubs.updateUserStore.callsFake(async () => {
        await builder.newUserCreationV3('bob');
      });

      const user = await users.findUser({ hashedUserId: hashedBobId });

      expect(user && user.userId).to.equal(utils.toBase64(hashedBobId));
    });
  });

  describe('findUsers', () => {
    it('fetches users', async () => {
      const { users, stubs, generator, builder } = await makeTestUsers();
      const hashedBobId = generator.userId('bob');
      const hashedAliceId = generator.userId('alice');
      const merlin = await builder.newUserCreationV3('merlin');

      await users.findUsers({ hashedUserIds: [merlin.entry.user_id, hashedBobId, hashedAliceId] });

      expect(stubs.forceSync.withArgs([merlin.entry.user_id, hashedBobId, hashedAliceId]).calledOnce).to.be.true;
      expect(stubs.updateUserStore.withArgs([merlin.entry.user_id, hashedBobId, hashedAliceId]).calledOnce).to.be.true;
    });

    it('returns users', async () => {
      const { users, builder } = await makeTestUsers();
      const alice = await builder.newUserCreationV3('alice');
      const bob = await builder.newUserCreationV3('bob');

      const hashedUserIds = [alice.entry.user_id, bob.entry.user_id];
      const retUsers = await users.findUsers({ hashedUserIds });
      const retUserIds = retUsers.map(u => u.userId);
      const expectedUserIds = hashedUserIds.map(id => utils.toBase64(id));
      expect(retUserIds).to.have.members(expectedUserIds);
    });

    it('returns all users including fetched ones', async () => {
      const { users, stubs, generator, builder } = await makeTestUsers();
      const hashedBobId = generator.userId('bob');
      const hashedAliceId = generator.userId('alice');
      const merlin = await builder.newUserCreationV3('merlin');
      const merlette = await builder.newUserCreationV3('merlette');

      stubs.updateUserStore.callsFake(async () => {
        await builder.newUserCreationV3('bob');
        await builder.newUserCreationV3('alice');
      });

      const hashedUserIds = [merlin.entry.user_id, merlette.entry.user_id, hashedBobId, hashedAliceId];
      const retUsers = await users.findUsers({ hashedUserIds });
      const retUserIds = retUsers.map(u => u.userId);
      const expectedUserIds = hashedUserIds.map(id => utils.toBase64(id));
      expect(retUserIds).to.have.members(expectedUserIds);
    });
  });

  describe('getUsers', () => {
    it('returns users', async () => {
      const { users, builder } = await makeTestUsers();
      const alice = await builder.newUserCreationV3('alice');
      const bob = await builder.newUserCreationV3('bob');

      const retUsers = await users.getUsers({ userIds: ['alice', 'bob'] });
      const retUserIds = retUsers.map(u => u.userId);
      const expectedUserIds = [alice, bob].map(u => utils.toBase64(u.entry.user_id));
      expect(retUserIds).to.have.members(expectedUserIds);
    });

    it('throws RecipientsNotFound as appropriate', async () => {
      const { users, builder } = await makeTestUsers();
      await builder.newUserCreationV3('alice');
      await builder.newUserCreationV3('bob');

      await expect(users.getUsers({ userIds: ['alice', 'bob', 'casper'] }))
        .to.be.rejectedWith(RecipientsNotFound);
    });
  });
});
