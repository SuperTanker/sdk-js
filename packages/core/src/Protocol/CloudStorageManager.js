// @flow
import { utils, type b64string } from '@tanker/crypto';
import streamCloudStorage from '@tanker/stream-cloud-storage';
import { getDataLength } from '@tanker/types';
import type { Data } from '@tanker/types';

import { InternalError } from '../errors';
import type { Client } from '../Network/Client';
import type { DataProtector, Streams } from '../DataProtection/DataProtector';
import { defaultDownloadType, extractOutputOptions } from '../DataProtection/options';
import { ProgressHandler } from '../DataProtection/ProgressHandler';
import type { OutputOptions, ProgressOptions, SharingOptions } from '../DataProtection/options';

const pipeStreams = (
  { streams, resolveEvent }: { streams: Array<$Values<Streams>>, resolveEvent: string }
) => new Promise((resolve, reject) => {
  streams.forEach(stream => stream.on('error', reject));
  streams.reduce((leftStream, rightStream) => leftStream.pipe(rightStream)).on(resolveEvent, resolve);
});

// Detection of: Edge | Edge iOS | Edge Android | Edge (Chromium-based)
const isEdge = () => /(edge|edgios|edga|edg)\//i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent);

export class CloudStorageManager {
  _client: Client;
  _dataProtector: DataProtector;
  _streams: Streams;

  constructor(
    client: Client,
    dataProtector: DataProtector,
    streams: Streams,
  ) {
    this._client = client;
    this._dataProtector = dataProtector;
    this._streams = streams;
  }

  async _encryptAndShareMetadata(metadata: Object, b64ResourceId: b64string): Promise<b64string> {
    const jsonMetadata = JSON.stringify(metadata);
    const clearMetadata = utils.fromString(jsonMetadata);
    const encryptedMetadata = await this._dataProtector.encryptData(clearMetadata, {}, { type: Uint8Array }, {}, b64ResourceId);
    return utils.toBase64(encryptedMetadata);
  }

  async _decryptMetadata(b64EncryptedMetadata: b64string): Promise<*> {
    const ecryptedMetadata = utils.fromBase64(b64EncryptedMetadata);
    const decryptedMetadata = await this._dataProtector.decryptData(ecryptedMetadata, { type: Uint8Array }, {});
    const jsonMetadata = utils.toString(decryptedMetadata);
    return JSON.parse(jsonMetadata);
  }

  async upload<T: Data>(clearData: Data, sharingOptions: SharingOptions, outputOptions: OutputOptions<T>, progressOptions: ProgressOptions): Promise<string> {
    const encryptor = await this._dataProtector.makeEncryptorStream(sharingOptions);
    const { resourceId } = encryptor;

    const totalClearSize = getDataLength(clearData);
    const totalEncryptedSize = encryptor.getEncryptedSize(totalClearSize);

    const { url, headers, service } = await this._client.send('get file upload url', {
      resource_id: resourceId,
      upload_content_length: totalEncryptedSize,
    });

    if (!streamCloudStorage[service])
      throw new InternalError(`unsupported cloud storage service: ${service}`);

    const { UploadStream } = streamCloudStorage[service];

    const { type, ...fileMetadata } = outputOptions;
    const metadata = { ...fileMetadata, clearContentLength: totalClearSize };
    const encryptedMetadata = await this._encryptAndShareMetadata(metadata, resourceId);

    const slicer = new this._streams.SlicerStream({ source: clearData });
    const uploader = new UploadStream(url, headers, totalEncryptedSize, encryptedMetadata);

    const progressHandler = new ProgressHandler(progressOptions).start(totalEncryptedSize);
    uploader.on('uploaded', (chunk: Uint8Array) => progressHandler.report(chunk.byteLength));

    const streams = [slicer, encryptor];

    // Some version of Edge (e.g. version 18) fail to handle the 308 HTTP status used by
    // GCS in a non-standard way (no redirection expected) when uploading in chunks. So we
    // add a merger stream before the uploader to ensure there's a single upload request
    // returning the 200 HTTP status.
    if (service === 'GCS' && isEdge()) {
      const merger = new this._streams.MergerStream({ type: Uint8Array });
      streams.push(merger);
    }

    streams.push(uploader);

    await pipeStreams({ streams, resolveEvent: 'finish' });

    return resourceId;
  }

  async download<T: Data>(resourceId: string, outputOptions: OutputOptions<T>, progressOptions: ProgressOptions): Promise<T> {
    const { url, service } = await this._client.send('get file download url', { // eslint-disable-line no-underscore-dangle
      resource_id: resourceId,
    });

    if (!streamCloudStorage[service])
      throw new InternalError(`unsupported cloud storage service: ${service}`);

    const { DownloadStream } = streamCloudStorage[service];

    const downloadChunkSize = 1024 * 1024;
    const downloader = new DownloadStream(resourceId, url, downloadChunkSize);

    const encryptedMetadata = await downloader.getMetadata();
    const { clearContentLength, ...fileMetadata } = await this._decryptMetadata(encryptedMetadata);
    const combinedOutputOptions = extractOutputOptions({ type: defaultDownloadType, ...outputOptions, ...fileMetadata });
    const merger = new this._streams.MergerStream(combinedOutputOptions);

    const decryptor = await this._dataProtector.makeDecryptorStream();

    const progressHandler = new ProgressHandler(progressOptions).start(clearContentLength);
    decryptor.on('data', (chunk: Uint8Array) => progressHandler.report(chunk.byteLength));

    return pipeStreams({ streams: [downloader, decryptor, merger], resolveEvent: 'data' });
  }
}

export default CloudStorageManager;
