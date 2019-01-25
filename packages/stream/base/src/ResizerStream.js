// @flow
import { Transform } from 'readable-stream';

import Uint8Buffer from './Uint8Buffer';

export default class ResizerStream extends Transform {
  _buffer: Uint8Buffer = new Uint8Buffer();
  _outputSize: number;

  constructor(outputSize: number) {
    super({
      writableHighWaterMark: outputSize,
      readableHighWaterMark: 1,
      readableObjectMode: true
    });
    this._outputSize = outputSize;
  }

  _pushChunks() {
    while (this._buffer.byteSize() >= this._outputSize) {
      const result = this._buffer.consume(this._outputSize);
      this.push(result);
    }
  }

  _pushLastChunk() {
    if (this._buffer.byteSize()) {
      const result = this._buffer.consume(this._buffer.byteSize());
      this.push(result);
    }
  }

  _transform(chunk: Uint8Array, encoding: ?string, callback: Function) {
    this._buffer.push(chunk);
    this._pushChunks();
    callback();
  }

  _flush(callback: Function) {
    this._pushChunks();
    this._pushLastChunk();
    callback();
  }
}
