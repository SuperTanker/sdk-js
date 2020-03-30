// @flow
import { InvalidArgument } from '@tanker/errors';

export const statusDefs = [
  /* 0 */ { name: 'STOPPED' },
  /* 1 */ { name: 'READY' },
  /* 2 */ { name: 'IDENTITY_REGISTRATION_NEEDED' },
  /* 3 */ { name: 'IDENTITY_VERIFICATION_NEEDED' },
];

export const statuses: { [name: string]: number } = (() => {
  const h = {};
  statusDefs.forEach((def, index) => {
    h[def.name] = index;
  });
  return h;
})();

export type Status = $Values<typeof statuses>;

export type EmailVerificationMethod = $Exact<{ type: 'email', email: string }>;
type PassphraseVerificationMethod = $Exact<{ type: 'passphrase' }>;
type KeyVerificationMethod = $Exact<{ type: 'verificationKey' }>;

export type VerificationMethod = EmailVerificationMethod | PassphraseVerificationMethod | KeyVerificationMethod;

export type EmailVerification = $Exact<{ email: string, verificationCode: string }>;
export type PassphraseVerification = $Exact<{ passphrase: string }>;
export type KeyVerification = $Exact<{ verificationKey: string }>;
export type OIDCVerification = $Exact<{ oidcIdToken: string }>;

export type Verification = EmailVerification | PassphraseVerification | KeyVerification | OIDCVerification;
export type RemoteVerification = EmailVerification | PassphraseVerification | OIDCVerification;

const validMethods = ['email', 'passphrase', 'verificationKey', 'oidcIdToken'];
const validKeys = [...validMethods, 'verificationCode'];

export const assertVerification = (verification: Verification) => {
  if (!verification || typeof verification !== 'object' || verification instanceof Array)
    throw new InvalidArgument('verification', 'object', verification);

  if (Object.keys(verification).some(k => !validKeys.includes(k)))
    throw new InvalidArgument('verification', `should only contain keys in ${JSON.stringify(validKeys)}`, verification);

  const methodCound = validMethods.reduce((count, key) => count + (key in verification ? 1 : 0), 0);

  if (methodCound !== 1)
    throw new InvalidArgument('verification', `should contain a single verification method in ${JSON.stringify(validMethods)}`, verification);

  if ('email' in verification) {
    if (typeof verification.email !== 'string')
      throw new InvalidArgument('verification', 'email should be a string', verification.email);
    if (!('verificationCode' in verification))
      throw new InvalidArgument('verification', 'verification should also have a verificationCode', verification);
    if (typeof verification.verificationCode !== 'string')
      throw new InvalidArgument('verification', 'verificationCode should be a string', verification.verificationCode);
  } else if ('passphrase' in verification && typeof verification.passphrase !== 'string') {
    throw new InvalidArgument('verification', 'passphrase should be a string', verification.passphrase);
  } else if ('verificationKey' in verification && typeof verification.verificationKey !== 'string') {
    throw new InvalidArgument('verification', 'verificationKey should be a string', verification.verificationKey);
  } else if ('oidcIdToken' in verification && typeof verification.oidcIdToken !== 'string') {
    throw new InvalidArgument('verification', 'oidcIdToken should be a string', verification.oidcIdToken);
  }
};
