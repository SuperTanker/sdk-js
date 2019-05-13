// @flow

import { utils, type b64string } from '@tanker/crypto';
import { _deserializeProvisionalIdentity } from '@tanker/identity';
import EventEmitter from 'events';

import { type ClientOptions, type UnlockMethods } from './Network/Client';
import { type DataStoreOptions } from './Session/Storage';
import { getResourceId as syncGetResourceId } from './Resource/ResourceManager';

import { InvalidSessionStatus, InvalidArgument } from './errors';
import { statusDefs, statuses, type Status, type VerificationMethod, assertVerificationMethod } from './Session/types';

import { extractUserData } from './UserData';
import { Session } from './Session/Session';
import { type EncryptionOptions, validateEncryptionOptions } from './DataProtection/EncryptionOptions';
import { type ShareWithOptions, validateShareWithOptions } from './DataProtection/ShareWithOptions';
import EncryptorStream from './DataProtection/EncryptorStream';
import DecryptorStream from './DataProtection/DecryptorStream';

import { TANKER_SDK_VERSION } from './version';

type TankerDefaultOptions = $Exact<{
  trustchainId?: b64string,
  socket?: any,
  url?: string,
  dataStore: DataStoreOptions,
  sdkType: string,
}>;

type TankerCoreOptions = $Exact<{
  trustchainId: b64string,
  socket?: any,
  url?: string,
  dataStore: DataStoreOptions,
  sdkType: string,
}>;

export type TankerOptions = $Exact<{
  trustchainId: b64string,
  socket?: any,
  url?: string,
  dataStore?: DataStoreOptions,
  sdkType?: string,
}>;

export function optionsWithDefaults(options: TankerOptions, defaults: TankerDefaultOptions): TankerCoreOptions {
  if (!options || typeof options !== 'object' || options instanceof Array)
    throw new InvalidArgument('options', 'object', options);

  if (!defaults || typeof defaults !== 'object' || defaults instanceof Array)
    throw new InvalidArgument('defaults', 'object', defaults);

  const result = { ...defaults, ...options };

  // Deep merge dataStore option
  if ('dataStore' in defaults)
    result.dataStore = { ...defaults.dataStore, ...options.dataStore };

  return result;
}

export class Tanker extends EventEmitter {
  _session: Session;
  _options: TankerCoreOptions;
  _clientOptions: ClientOptions;
  _dataStoreOptions: DataStoreOptions;

  static version = TANKER_SDK_VERSION;
  static statuses = statuses;

  constructor(options: TankerCoreOptions) {
    super();

    if (!options || typeof options !== 'object' || options instanceof Array) {
      throw new InvalidArgument('options', 'object', options);
    }

    if (typeof options.trustchainId !== 'string') {
      throw new InvalidArgument('options.trustchainId', 'string', options.trustchainId);
    }

    if (typeof options.dataStore !== 'object' || options.dataStore instanceof Array) {
      throw new InvalidArgument('options.dataStore', 'object', options.dataStore);
    } else if (typeof options.dataStore.adapter !== 'function') {
      throw new InvalidArgument('options.dataStore.adapter', 'function', options.dataStore.adapter);
    }
    if (typeof options.sdkType !== 'string') {
      throw new InvalidArgument('options.sdkType', 'string', options.sdkType);
    }

    this._options = options;

    const clientOptions: ClientOptions = {
      sdkInfo: {
        version: Tanker.version,
        type: options.sdkType,
        trustchainId: options.trustchainId
      }
    };
    if (options.socket) { clientOptions.socket = options.socket; }
    if (options.url) { clientOptions.url = options.url; }
    this._clientOptions = clientOptions;

    const datastoreOptions: DataStoreOptions = {
      adapter: options.dataStore.adapter
    };
    if (options.dataStore.prefix) { datastoreOptions.prefix = options.dataStore.prefix; }
    if (options.dataStore.dbPath) { datastoreOptions.dbPath = options.dataStore.dbPath; }
    if (options.dataStore.url) { datastoreOptions.url = options.dataStore.url; }
    this._dataStoreOptions = datastoreOptions;

    /* eslint-disable no-underscore-dangle */
    if (typeof window !== 'undefined' && window.__TANKER_DEVTOOLS_GLOBAL_HOOK__) {
      window.__TANKER_DEVTOOLS_GLOBAL_HOOK__.registerTanker(this);
    }
  }

  get trustchainId(): b64string {
    return this._options.trustchainId;
  }

  get options(): TankerCoreOptions {
    return this._options;
  }

  get status(): Status {
    if (!this._session) {
      return statuses.STOPPED;
    }
    return this._session.status;
  }

  get statusName(): string {
    const def = statusDefs[this.status];
    return def ? def.name : `invalid status: ${this.status}`;
  }

  addListener(eventName: string, listener: any): any {
    return this.on(eventName, listener);
  }

  on(eventName: string, listener: any): any {
    return super.on(eventName, listener);
  }

  once(eventName: string, listener: any): any {
    return super.once(eventName, listener);
  }

  _setSession = (session: ?Session) => {
    if (session) {
      session.localUser.on('device_revoked', this._nuke);
      this._session = session;
    } else {
      delete this._session;
      this.emit('sessionClosed');
    }
    this.emit('statusChange', this.status);
  }

  get deviceId(): b64string {
    this.assert(statuses.READY, 'get device ID');
    if (!this._session.storage.keyStore || !this._session.storage.keyStore.deviceId)
      throw new Error('Tried to get our device hash, but could not find it!');

    return utils.toBase64(this._session.storage.keyStore.deviceId);
  }

  assert(status: number, to: string): void {
    if (this.status !== status) {
      const { name } = statusDefs[status];
      const message = `Expected status ${name} but got ${this.statusName} trying to ${to}.`;
      throw new InvalidSessionStatus(this.status, message);
    }
  }

  async start(identityB64: b64string) {
    this.assert(statuses.STOPPED, 'start a session');
    const userData = this._parseIdentity(identityB64);

    const session = await Session.init(userData, this._dataStoreOptions, this._clientOptions);
    this._setSession(session);
    return this.status;
  }

  async registerIdentity(verificationMethod: VerificationMethod): Promise<void> {
    this.assert(statuses.IDENTITY_REGISTRATION_NEEDED, 'register an identity');
    assertVerificationMethod(verificationMethod);
    await this._session.createUser(verificationMethod);
    this.emit('statusChange', this.status);
  }

  async verifyIdentity(verificationMethod: VerificationMethod): Promise<void> {
    this.assert(statuses.IDENTITY_VERIFICATION_NEEDED, 'verify an identity');
    assertVerificationMethod(verificationMethod);
    await this._session.unlockUser(verificationMethod);
    this.emit('statusChange', this.status);
  }

  async updateVerificationMethod(verificationMethod: VerificationMethod): Promise<void> {
    this.assert(statuses.READY, 'update a verification method');
    assertVerificationMethod(verificationMethod);
    if (verificationMethod.email || verificationMethod.passphrase) {
      return this._session.updateUnlock(verificationMethod);
    } else {
      throw new InvalidArgument('verificationMethod', 'cannot update a verification key', verificationMethod);
    }
  }

  _parseIdentity(identityB64: b64string) {
    // Type verif arguments
    if (!identityB64 || typeof identityB64 !== 'string')
      throw new InvalidArgument('identity', 'b64string', identityB64);
    // End type verif
    const userData = extractUserData(identityB64);

    if (this.trustchainId !== utils.toBase64(userData.trustchainId))
      throw new InvalidArgument('identity', 'b64string', identityB64);
    return userData;
  }

  async stop(): Promise<void> {
    const session = this._session;
    this._setSession(null);

    if (session) {
      await session.close();
    }
  }

  _nuke = async (): Promise<void> => {
    const session = this._session;
    this._setSession(null);
    if (session) {
      await session.nuke();
    }
    this.emit('deviceRevoked');
  }

  get registeredVerificationMethods(): UnlockMethods {
    this.assert(statuses.READY, 'has registered unlock methods');
    return this._session.localUser.unlockMethods;
  }

  hasRegisteredVerificationMethods(): bool {
    this.assert(statuses.READY, 'has registered unlock methods');
    return this.registeredVerificationMethods.length !== 0;
  }

  hasRegisteredVerificationMethod(method: "passphrase" | "email"): bool {
    this.assert(statuses.READY, 'has registered unlock method');
    if (['passphrase', 'email'].indexOf(method) === -1) {
      throw new InvalidArgument('method', 'passphrase or email', method);
    }
    return this.registeredVerificationMethods.some(item => method === item.type);
  }

  async generateVerificationKey(): Promise<string> {
    this.assert(statuses.IDENTITY_REGISTRATION_NEEDED, 'generate a verification key');
    return this._session.generateVerificationKey();
  }

  async getDeviceList(): Promise<Array<{id: string, isRevoked: bool}>> {
    this.assert(statuses.READY, 'get the device list');
    const allDevices = await this._session.apis.userAccessor.findUserDevices({ userId: this._session.localUser.userId });
    return allDevices.filter(d => !d.isGhostDevice).map(d => ({ id: d.id, isRevoked: d.isRevoked }));
  }

  _parseEncryptionOptions = (options?: EncryptionOptions = {}): EncryptionOptions => {
    if (!validateEncryptionOptions(options))
      throw new InvalidArgument('options', '{ shareWithUsers?: Array<b64string>, shareWithGroups?: Array<String> }', options);

    return options;
  }

  async share(resourceIds: Array<b64string>, shareWithOptions: ShareWithOptions): Promise<void> {
    this.assert(statuses.READY, 'share');

    if (!(resourceIds instanceof Array))
      throw new InvalidArgument('resourceIds', 'Array<b64string>', resourceIds);

    if (!validateShareWithOptions(shareWithOptions))
      throw new InvalidArgument('shareWithOptions', '{ shareWithUsers: Array<b64string>, shareWithGroups: Array<string> }', shareWithOptions);

    return this._session.apis.dataProtector.share(resourceIds, shareWithOptions);
  }

  async getResourceId(encryptedData: Uint8Array): Promise<b64string> {
    if (!(encryptedData instanceof Uint8Array))
      throw new InvalidArgument('encryptedData', 'Uint8Array', encryptedData);

    return utils.toBase64(syncGetResourceId(encryptedData));
  }

  async revokeDevice(deviceId: b64string): Promise<void> {
    this.assert(statuses.READY, 'revoke a device');

    if (typeof deviceId !== 'string')
      throw new InvalidArgument('deviceId', 'string', deviceId);
    return this._session.apis.deviceManager.revokeDevice(deviceId);
  }

  async createGroup(users: Array<b64string>): Promise<b64string> {
    this.assert(statuses.READY, 'create a group');

    if (!(users instanceof Array))
      throw new InvalidArgument('users', 'Array<string>', users);

    return this._session.apis.groupManager.createGroup(users);
  }

  async updateGroupMembers(groupId: string, args: $Exact<{ usersToAdd: Array<string> }>): Promise<void> {
    this.assert(statuses.READY, 'update a group');

    const { usersToAdd } = args;

    if (!usersToAdd || !(usersToAdd instanceof Array))
      throw new InvalidArgument('usersToAdd', 'Array<string>', usersToAdd);

    if (typeof groupId !== 'string')
      throw new InvalidArgument('groupId', 'string', groupId);

    return this._session.apis.groupManager.updateGroupMembers(groupId, usersToAdd);
  }

  async claimProvisionalIdentity(provisionalIdentity: b64string, verificationCodeNoPad: string): Promise<void> {
    this.assert(statuses.READY, 'claim invite');

    const verificationCode = utils.toBase64(utils.fromSafeBase64(verificationCodeNoPad));
    const provisionalIdentityObj = _deserializeProvisionalIdentity(provisionalIdentity);

    return this._session.apis.deviceManager.claimProvisionalIdentity(provisionalIdentityObj, verificationCode);
  }

  async makeEncryptorStream(options?: EncryptionOptions): Promise<EncryptorStream> {
    this.assert(statuses.READY, 'make a stream encryptor');

    const opts = this._parseEncryptionOptions(options);

    return this._session.apis.dataProtector.makeEncryptorStream(opts);
  }

  async makeDecryptorStream(): Promise<DecryptorStream> {
    this.assert(statuses.READY, 'make a stream decryptor');

    return this._session.apis.dataProtector.makeDecryptorStream();
  }
}

export default Tanker;
