// @flow

// $FlowIKnow cross-browser compat
const blobSlice: Function = Blob.prototype.slice || Blob.prototype.mozSlice || Blob.prototype.webkitSlice;

export default class FileReader {
  _source: Blob;
  _reader: window.FileReader;
  _readPositions: {| start: number, end: number |} = { start: 0, end: 0 };
  _currentRead: ?{| resolve: Function, reject: Function |};

  constructor(source: Blob | File) {
    this._source = source;

    this._reader = new window.FileReader();
    this._reader.addEventListener('load', this._onLoad.bind(this));
    this._reader.addEventListener('error', this._onError.bind(this));
  }

  _onLoad() {
    if (!this._currentRead)
      throw new Error('Assertion error: a result was received but no read operation was in progress');

    const { resolve } = this._currentRead;
    this._currentRead = null;
    resolve(this._reader.result);
  }

  _onError() {
    if (!this._currentRead)
      throw new Error('Assertion error: a result was received but no read operation was in progress');

    const { reject } = this._currentRead;
    this._currentRead = null;
    reject(this._reader.error);
  }

  _assertNoReadInProgress() {
    if (this._currentRead)
      throw new Error('Assertion error: a read operation is already in progress');
  }

  abort() { return this._reader.abort(); }

  async readAsDataURL() {
    this._assertNoReadInProgress();

    return new Promise((resolve, reject) => {
      this._currentRead = { resolve, reject };
      this._reader.readAsDataURL(this._source);
    });
  }

  async readAsText(encoding?: string) {
    this._assertNoReadInProgress();

    return new Promise((resolve, reject) => {
      this._currentRead = { resolve, reject };
      this._reader.readAsText(this._source, encoding);
    });
  }

  async readAsArrayBuffer(byteSize?: number) {
    this._assertNoReadInProgress();

    const start = this._readPositions.end;
    const end = byteSize ? Math.min(start + byteSize, this._source.size) : this._source.size;

    this._readPositions = { start, end };

    return new Promise((resolve, reject) => {
      this._currentRead = { resolve, reject };
      this._reader.readAsArrayBuffer(blobSlice.call(this._source, start, end));
    });
  }
}
