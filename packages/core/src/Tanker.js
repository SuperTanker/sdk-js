// @flow
import EventEmitter from 'events';
import { tcrypto, utils, type b64string } from '@tanker/crypto';
import { InternalError, InvalidArgument } from '@tanker/errors';
import { assertDataType, castData } from '@tanker/types';
import type { Data } from '@tanker/types';
import { _deserializeProvisionalIdentity } from '@tanker/identity';

import { type ClientOptions, defaultApiEndpoint } from './Network/Client';
import { type DataStoreOptions } from './Session/Storage';

import type { Verification, EmailVerification, OIDCVerification, RemoteVerification, VerificationMethod } from './LocalUser/types';
import { assertVerification } from './LocalUser/types';
import { extractUserData } from './LocalUser/UserData';

import { assertStatus, statusDefs, statuses, type Status } from './Session/status';
import { Session } from './Session/Session';

import type { OutputOptions, ProgressOptions, EncryptionOptions, SharingOptions } from './DataProtection/options';
import { defaultDownloadType, extractOutputOptions, extractProgressOptions, extractEncryptionOptions, extractSharingOptions, isObject, isSharingOptionsEmpty } from './DataProtection/options';
import EncryptorStream from './DataProtection/EncryptorStream';
import DecryptorStream from './DataProtection/DecryptorStream';
import { extractEncryptionFormat, SAFE_EXTRACTION_LENGTH } from './DataProtection/types';
import type { EncryptionSession } from './DataProtection/EncryptionSession';

import { TANKER_SDK_VERSION } from './version';

type TankerCoreOptions = $Exact<{
  appId?: b64string,
  trustchainId?: b64string,
  url?: string,
  dataStore: DataStoreOptions,
  sdkType: string,
}>;

export type TankerOptions = $Exact<{
  appId?: b64string,
  trustchainId?: b64string,
  url?: string,
  dataStore?: DataStoreOptions,
  sdkType?: string,
}>;

export function optionsWithDefaults(options: TankerOptions, defaults: TankerCoreOptions): TankerCoreOptions {
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
  _trustchainId: b64string;
  _session: ?Session;
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

    if ('appId' in options) {
      if (typeof options.appId !== 'string') {
        throw new InvalidArgument('options.appId', 'string', options.appId);
      }

      this._trustchainId = options.appId;
    } else if ('trustchainId' in options) {
      if (typeof options.trustchainId !== 'string') {
        throw new InvalidArgument('options.trustchainId', 'string', options.trustchainId);
      }

      this._trustchainId = options.trustchainId;
      console.warn('"trustchainId" option has been deprecated in favor of "appId", it will be removed in the next major release.');
    } else {
      throw new InvalidArgument('options.appId', 'string', options.appId);
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
        type: options.sdkType,
        version: Tanker.version,
      },
      url: defaultApiEndpoint,
    };
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

  get appId(): b64string {
    return this._trustchainId;
  }

  get trustchainId(): b64string {
    return this._trustchainId;
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

  set session(session: ?Session) {
    if (session) {
      this._session = session;
    } else {
      delete this._session;
    }
  }

  get session() {
    if (!this._session)
      throw new InternalError('Trying to access non existing _session');
    return this._session;
  }

  get deviceId(): b64string {
    assertStatus(this.status, statuses.READY, 'get the device id');

    const deviceId = this.session.deviceId();
    if (!deviceId)
      throw new InternalError('Tried to get our device id, but could not find it!');

    return utils.toBase64(deviceId);
  }

  async start(identityB64: b64string) {
    assertStatus(this.status, statuses.STOPPED, 'start a session');

    // Prepare the session
    const userData = this._parseIdentity(identityB64);
    const session = await Session.init(userData, this._dataStoreOptions, this._clientOptions);

    // Watch and start the session
    session.on('device_revoked', () => this._deviceRevoked());
    session.on('fatal_error', () => this.stop());
    session.on('status_change', (s) => this.emit('statusChange', s));
    await session.start();

    // Set the session only if properly started
    this.session = session;

    return this.status;
  }

  async registerIdentity(verification: Verification): Promise<void> {
    assertStatus(this.status, statuses.IDENTITY_REGISTRATION_NEEDED, 'register an identity');
    assertVerification(verification);
    await this.session.createUser(verification);
  }

  async verifyIdentity(verification: Verification): Promise<void> {
    assertStatus(this.status, statuses.IDENTITY_VERIFICATION_NEEDED, 'verify an identity');
    assertVerification(verification);
    await this.session.createNewDevice(verification);
  }

  async setVerificationMethod(verification: RemoteVerification): Promise<void> {
    assertStatus(this.status, statuses.READY, 'set a verification method');

    assertVerification(verification);
    if ('verificationKey' in verification)
      throw new InvalidArgument('verification', 'cannot update a verification key', verification);

    return this.session.setVerificationMethod(verification);
  }

  async getVerificationMethods(): Promise<Array<VerificationMethod>> {
    assertStatus(this.status, [statuses.READY, statuses.IDENTITY_VERIFICATION_NEEDED], 'get verification methods');
    return this.session.getVerificationMethods();
  }

  async generateVerificationKey(): Promise<string> {
    assertStatus(this.status, statuses.IDENTITY_REGISTRATION_NEEDED, 'generate a verification key');
    return this.session.generateVerificationKey();
  }

  async attachProvisionalIdentity(provisionalIdentity: b64string): Promise<*> {
    assertStatus(this.status, statuses.READY, 'attach a provisional identity');

    const provisionalIdentityObj = _deserializeProvisionalIdentity(provisionalIdentity);

    return this.session.attachProvisionalIdentity(provisionalIdentityObj);
  }

  async verifyProvisionalIdentity(verification: EmailVerification | OIDCVerification): Promise<void> {
    assertStatus(this.status, statuses.READY, 'verify a provisional identity');
    assertVerification(verification);
    return this.session.verifyProvisionalIdentity(verification);
  }

  _parseIdentity(identityB64: b64string) {
    // Type verif arguments
    if (!identityB64 || typeof identityB64 !== 'string')
      throw new InvalidArgument('identity', 'b64string', identityB64);
    // End type verif
    const userData = extractUserData(identityB64);
    const userDataTrustchainId = utils.toBase64(userData.trustchainId);

    if (this.trustchainId !== userDataTrustchainId)
      throw new InvalidArgument(`The provided identity was not signed by the private key of the current trustchain: expected trustchain id "${this.trustchainId}", but got "${userDataTrustchainId}"`);
    return userData;
  }

  async stop(): Promise<void> {
    if (this._session) {
      const session = this._session;
      this.session = null;
      await session.stop();
    }
  }

  _deviceRevoked = async (): Promise<void> => {
    this.session = null; // the session has already closed itself
    this.emit('deviceRevoked');
  }

  async getDeviceList(): Promise<Array<{id: string, isRevoked: bool}>> {
    assertStatus(this.status, statuses.READY, 'get the device list');
    const devices = await this.session.listDevices();
    return devices.map(d => ({ id: utils.toBase64(d.deviceId), isRevoked: d.revoked }));
  }

  async share(resourceIds: Array<b64string>, options: SharingOptions): Promise<void> {
    assertStatus(this.status, statuses.READY, 'share');

    if (!(resourceIds instanceof Array) || resourceIds.some(id => typeof id !== 'string'))
      throw new InvalidArgument('resourceIds', 'Array<b64string>', resourceIds);

    const sharingOptions = extractSharingOptions(options);

    if (isSharingOptionsEmpty(sharingOptions)) {
      throw new InvalidArgument(
        'options.shareWith*',
        'options.shareWithUsers or options.shareWithGroups must contain recipients',
        options
      );
    }

    return this.session.share(resourceIds, sharingOptions);
  }

  async getResourceId(encryptedData: Uint8Array): Promise<b64string> {
    assertStatus(this.status, statuses.READY, 'get a resource id');
    assertDataType(encryptedData, 'encryptedData');

    const castEncryptedData = await castData(encryptedData, { type: Uint8Array }, SAFE_EXTRACTION_LENGTH);

    const encryption = extractEncryptionFormat(castEncryptedData);

    return utils.toBase64(encryption.extractResourceId(castEncryptedData));
  }

  async revokeDevice(b64DeviceId: b64string): Promise<void> {
    assertStatus(this.status, statuses.READY, 'revoke a device');

    if (typeof b64DeviceId !== 'string')
      throw new InvalidArgument('deviceId', 'string', b64DeviceId);

    const deviceId = utils.fromBase64(b64DeviceId);

    if (deviceId.length !== tcrypto.HASH_SIZE)
      throw new InvalidArgument('the provided string does not look like a valid deviceId');

    return this.session.revokeDevice(deviceId);
  }

  async createGroup(users: Array<b64string>): Promise<b64string> {
    assertStatus(this.status, statuses.READY, 'create a group');

    if (!(users instanceof Array))
      throw new InvalidArgument('users', 'Array<string>', users);

    return this.session.createGroup(users);
  }

  async updateGroupMembers(groupId: string, args: $Exact<{ usersToAdd: Array<string> }>): Promise<void> {
    assertStatus(this.status, statuses.READY, 'update a group');

    const { usersToAdd } = args;

    if (!usersToAdd || !(usersToAdd instanceof Array))
      throw new InvalidArgument('usersToAdd', 'Array<string>', usersToAdd);

    if (typeof groupId !== 'string')
      throw new InvalidArgument('groupId', 'string', groupId);

    return this.session.updateGroupMembers(groupId, usersToAdd);
  }

  async makeEncryptorStream(options: EncryptionOptions = {}): Promise<EncryptorStream> {
    assertStatus(this.status, statuses.READY, 'make a stream encryptor');

    const encryptionOptions = extractEncryptionOptions(options);

    return this.session.makeEncryptorStream(encryptionOptions);
  }

  async makeDecryptorStream(): Promise<DecryptorStream> {
    assertStatus(this.status, statuses.READY, 'make a stream decryptor');

    return this.session.makeDecryptorStream();
  }

  async encryptData<T: Data>(clearData: Data, options?: $Shape<EncryptionOptions & OutputOptions<T> & ProgressOptions> = {}): Promise<T> {
    assertStatus(this.status, statuses.READY, 'encrypt data');
    assertDataType(clearData, 'clearData');

    const outputOptions = extractOutputOptions(options, clearData);
    const progressOptions = extractProgressOptions(options);
    const encryptionOptions = extractEncryptionOptions(options);

    return this.session.encryptData(clearData, encryptionOptions, outputOptions, progressOptions);
  }

  async encrypt<T: Data>(plain: string, options?: $Shape<EncryptionOptions & OutputOptions<T> & ProgressOptions>): Promise<T> {
    assertStatus(this.status, statuses.READY, 'encrypt');

    if (typeof plain !== 'string')
      throw new InvalidArgument('plain', 'string', plain);

    return this.encryptData(utils.fromString(plain), options);
  }

  async decryptData<T: Data>(encryptedData: Data, options?: $Shape<OutputOptions<T> & ProgressOptions> = {}): Promise<T> {
    assertStatus(this.status, statuses.READY, 'decrypt data');
    assertDataType(encryptedData, 'encryptedData');

    const outputOptions = extractOutputOptions(options, encryptedData);
    const progressOptions = extractProgressOptions(options);

    return this.session.decryptData(encryptedData, outputOptions, progressOptions);
  }

  async decrypt(cipher: Data, options?: $Shape<ProgressOptions> = {}): Promise<string> {
    const progressOptions = extractProgressOptions(options);
    return utils.toString(await this.decryptData(cipher, { ...progressOptions, type: Uint8Array }));
  }

  async upload<T: Data>(clearData: Data, options?: $Shape<EncryptionOptions & OutputOptions<T> & ProgressOptions> = {}): Promise<string> {
    assertStatus(this.status, statuses.READY, 'upload a file');
    assertDataType(clearData, 'clearData');

    const outputOptions = extractOutputOptions(options, clearData);
    const progressOptions = extractProgressOptions(options);
    const encryptionOptions = extractEncryptionOptions(options);

    return this.session.upload(clearData, encryptionOptions, outputOptions, progressOptions);
  }

  async download<T: Data>(resourceId: string, options?: $Shape<OutputOptions<T> & ProgressOptions> = {}): Promise<T> {
    assertStatus(this.status, statuses.READY, 'download a file');

    // Best effort to catch values that can't be a resourceId before reaching the server
    if (typeof resourceId !== 'string' || utils.fromBase64(resourceId).length !== tcrypto.MAC_SIZE)
      throw new InvalidArgument('resourceId', 'string', resourceId);

    if (!isObject(options))
      throw new InvalidArgument('options', '{ type: Class<T>, mime?: string, name?: string, lastModified?: number }', options);

    const outputOptions = extractOutputOptions({ type: defaultDownloadType, ...options });
    const progressOptions = extractProgressOptions(options);

    return this.session.download(resourceId, outputOptions, progressOptions);
  }

  async createEncryptionSession(options: EncryptionOptions = {}): Promise<EncryptionSession> {
    assertStatus(this.status, statuses.READY, 'create an encryption session');

    const encryptionOptions = extractEncryptionOptions(options);

    return this.session.createEncryptionSession(encryptionOptions);
  }
}

export default Tanker;
