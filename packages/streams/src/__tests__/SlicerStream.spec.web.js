// @flow
import { utils } from '@tanker/crypto';

import { expect } from './chai';
import SlicerStream from '../SlicerStream.web';

describe('SlicerStream (web)', () => {
  const bytes: Uint8Array = utils.fromString('0123456789abcdef'); // 16 bytes
  const outputSize = 4;

  [
    { source: bytes },
    { source: bytes.buffer },
    { source: new Blob([bytes]) },
    { source: new File([bytes], 'file.txt') },
  ].forEach(options => {
    const { source } = options;

    it(`can slice a ${source.constructor.name}`, async () => {
      const stream = new SlicerStream({ ...options, outputSize });

      const output: Array<Uint8Array> = [];
      stream.on('data', (data) => { output.push(data); });

      const testPromise = new Promise((resolve, reject) => {
        stream.on('error', reject);
        stream.on('end', () => {
          try {
            expect(output).to.have.lengthOf(Math.ceil(bytes.length / outputSize));
            output.forEach((chunk, index) => {
              expect(chunk).to.be.an.instanceOf(Uint8Array);
              expect(chunk).to.deep.equal(bytes.subarray(index * outputSize, (index + 1) * outputSize));
            });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });

      await expect(testPromise).to.be.fulfilled;
    });
  });
});
