// @flow
import sodium from 'libsodium-wrappers';
import { type b64string, type safeb64string } from './aliases';

function assertArrayTypes(a: Uint8Array, b: Uint8Array) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) {
    const typea = (a instanceof Uint8Array) ? 'Uint8Array' : typeof a;
    const typeb = (b instanceof Uint8Array) ? 'Uint8Array' : typeof b;
    throw new TypeError(`Expected two Uint8Arrays, got ${typea} and ${typeb}`);
  }
}

export function toBase64(bytes: Uint8Array): b64string {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError('"bytes" is not a Uint8Array');

  return sodium.to_base64(bytes);
}

export function fromBase64(str: b64string): Uint8Array {
  if (typeof str !== 'string')
    throw new TypeError('"str" is not a string');

  return sodium.from_base64(str);
}

// Note: use /[=/+]/g regex to strip padding, /[/+]/g otherwise
function base64ToUrlsafeReplacer(char: string) {
  if (char === '/') return '_';
  if (char === '+') return '-';
  return '';
}

// Base 64 encoding with URL and Filename Safe Alphabet
// See: https://tools.ietf.org/html/rfc4648#page-7
export function toSafeBase64(bytes: Uint8Array): safeb64string {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError('"bytes" is not a Uint8Array');

  return toBase64(bytes).replace(/[/+]/g, base64ToUrlsafeReplacer);
}

function base64FromUrlsafeReplacer(char: string) {
  if (char === '_') return '/';
  if (char === '-') return '+';
  return '';
}

export function fromSafeBase64(str: safeb64string): Uint8Array {
  if (typeof str !== 'string')
    throw new TypeError('"str" is not a string');

  return fromBase64(str.replace(/[-_]/g, base64FromUrlsafeReplacer));
}

export function toHex(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError('"bytes" is not a Uint8Array');

  return sodium.to_hex(bytes);
}

export function fromHex(str: string): Uint8Array {
  if (typeof str !== 'string')
    throw new TypeError('"str" is not a string');

  return sodium.from_hex(str);
}

export function toString(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError('"bytes" is not a Uint8Array');

  return sodium.to_string(bytes);
}

export function fromString(str: string): Uint8Array {
  if (typeof str !== 'string')
    throw new TypeError('"str" is not a string');

  return sodium.from_string(str);
}

export function fromB64Json(str: b64string): Object {
  return JSON.parse(toString(fromBase64(str)));
}

export function toB64Json(o: Object): b64string {
  return toBase64(fromString(JSON.stringify(o)));
}

export function concatArrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  assertArrayTypes(a, b);

  const ab = new Uint8Array(a.length + b.length);
  ab.set(a);
  ab.set(b, a.length);

  return ab;
}

export function equalArray(b1: Uint8Array, b2: Uint8Array): bool {
  assertArrayTypes(b1, b2);

  if (b1.length !== b2.length)
    return false;

  for (let i = 0; i < b1.length; i++)
    if (b1[i] !== b2[i])
      return false;

  return true;
}

export function isNullArray(a: Uint8Array): bool {
  return equalArray(a, new Uint8Array(a.length));
}


export function equalConstTime(b1: Uint8Array, b2: Uint8Array): bool {
  assertArrayTypes(b1, b2);

  if (b1.length !== b2.length)
    return false;

  let res = 0;
  for (let i = 0; i < b1.length; i++)
    res |= b1[i] ^ b2[i]; // eslint-disable-line

  return res === 0;
}

export function memzero(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError('"bytes" is not a Uint8Array');

  sodium.memzero(bytes);
}
