// @flow
import { utils, type b64string } from '@tanker/crypto';
import { InternalError } from '@tanker/errors';
import { MergerStream, ResizerStream, SlicerStream } from '@tanker/stream-base';
import type { Readable, Writable } from '@tanker/stream-base';
import streamCloudStorage from '@tanker/stream-cloud-storage';
import { getDataLength } from '@tanker/types';
import type { Data, ResourceMetadata } from '@tanker/types';

import type { Client } from '../Network/Client';
import { getStreamEncryptionFormatDescription, getClearSize } from '../DataProtection/types';
import type { EncryptionFormatDescription, Resource } from '../DataProtection/types';
import type { DataProtector } from '../DataProtection/DataProtector';
import { ProgressHandler } from '../DataProtection/ProgressHandler';
import { defaultDownloadType } from '../DataProtection/options';
import type { OutputOptions, ProgressOptions, EncryptionOptions } from '../DataProtection/options';
import { UploadStream } from './UploadStream';
import { DownloadStream } from './DownloadStream';

const pipeStreams = (
  { streams, resolveEvent }: { streams: Array<Readable | Writable>, resolveEvent: string }
) => new Promise((resolve, reject) => {
  streams.forEach(stream => stream.on('error', reject));
  streams.reduce((leftStream, rightStream) => leftStream.pipe(rightStream)).on(resolveEvent, resolve);
});

// Detection of: Edge | Edge iOS | Edge Android - but not Edge (Chromium-based)
const isEdge = () => /(edge|edgios|edga)\//i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent);

type Metadata = $Exact<{ encryptionFormat: EncryptionFormatDescription } & ResourceMetadata>;

export class CloudStorageManager {
  _client: Client;
  _dataProtector: DataProtector;

  constructor(
    client: Client,
    dataProtector: DataProtector,
  ) {
    this._client = client;
    this._dataProtector = dataProtector;
  }

  async _encryptAndShareMetadata(metadata: Metadata, resource: Resource): Promise<b64string> {
    const jsonMetadata = JSON.stringify(metadata);
    const clearMetadata = utils.fromString(jsonMetadata);
    const encryptedMetadata = await this._dataProtector.encryptData(clearMetadata, {}, { type: Uint8Array }, {}, resource);
    return utils.toBase64(encryptedMetadata);
  }

  async _decryptMetadata(b64EncryptedMetadata: b64string): Promise<Metadata> {
    const encryptedMetadata = utils.fromBase64(b64EncryptedMetadata);
    const decryptedMetadata = await this._dataProtector.decryptData(encryptedMetadata, { type: Uint8Array }, {});
    const jsonMetadata = utils.toString(decryptedMetadata);
    return JSON.parse(jsonMetadata);
  }

  async upload(clearData: Data, encryptionOptions: EncryptionOptions, resourceMetadata: ResourceMetadata, progressOptions: ProgressOptions): Promise<b64string> {
    const totalClearSize = getDataLength(clearData);
    const slicer = new SlicerStream({ source: clearData });
    const uploadStream = await this.createUploadStream(totalClearSize, encryptionOptions, resourceMetadata, progressOptions);
    const streams = [slicer, uploadStream];

    await pipeStreams({ streams, resolveEvent: 'finish' });

    return uploadStream.resourceId;
  }

  async download<T: Data>(b64ResourceId: string, outputOptions: OutputOptions<T>, progressOptions: ProgressOptions): Promise<T> {
    const downloadStream = await this.createDownloadStream(b64ResourceId, progressOptions);
    const merger = new MergerStream({
      type: defaultDownloadType,
      ...outputOptions,
      ...downloadStream.metadata
    });

    return pipeStreams({ streams: [downloadStream, merger], resolveEvent: 'data' });
  }

  async createUploadStream(clearSize: number, encryptionOptions: EncryptionOptions, resourceMetadata: ResourceMetadata, progressOptions: ProgressOptions): Promise<UploadStream> {
    const encryptor = await this._dataProtector.createEncryptionStream(encryptionOptions);
    const { _resourceId: resourceId, _key: key } = encryptor;
    const b64ResourceId = utils.toBase64(resourceId);

    const totalClearSize = clearSize;
    const totalEncryptedSize = encryptor.getEncryptedSize(totalClearSize);

    const metadata: $Shape<Metadata> = {
      ...resourceMetadata,
      encryptionFormat: getStreamEncryptionFormatDescription(),
    };
    const encryptedMetadata = await this._encryptAndShareMetadata(metadata, { resourceId, key });

    const {
      urls,
      headers,
      service,
      recommended_chunk_size: recommendedChunkSize
    } = await this._client.getFileUploadURL(resourceId, encryptedMetadata, totalEncryptedSize);

    if (!streamCloudStorage[service])
      throw new InternalError(`unsupported cloud storage service: ${service}`);

    const streamService = streamCloudStorage[service];
    const { UploadStream: CloudUploadStream } = streamService;

    const uploader = new CloudUploadStream(urls, headers, totalEncryptedSize, recommendedChunkSize);

    const progressHandler = new ProgressHandler(progressOptions).start(totalEncryptedSize);
    uploader.on('uploaded', (chunk: Uint8Array) => progressHandler.report(chunk.byteLength));

    const streams = [encryptor];

    // Some version of Edge (e.g. version 18) fail to handle the 308 HTTP status used by
    // GCS in a non-standard way (no redirection expected) when uploading in chunks. So we
    // add a merger stream before the uploader to ensure there's a single upload request
    // returning the 200 HTTP status.
    if (service === 'GCS' && isEdge()) {
      const merger = new MergerStream({ type: Uint8Array });
      streams.push(merger);
    } else if (service === 'S3') {
      const resizer = new ResizerStream(recommendedChunkSize);
      streams.push(resizer);
    }

    streams.push(uploader);

    return new UploadStream(b64ResourceId, streams);
  }

  async createDownloadStream(b64ResourceId: string, progressOptions: ProgressOptions): Promise<DownloadStream> {
    const resourceId = utils.fromBase64(b64ResourceId);

    const { head_url: headUrl, get_url: getUrl, service } = await this._client.getFileDownloadURL(resourceId);

    if (!streamCloudStorage[service])
      throw new InternalError(`unsupported cloud storage service: ${service}`);

    const { DownloadStream: CloudDownloadStream } = streamCloudStorage[service];

    const downloadChunkSize = 1024 * 1024;
    const downloader = new CloudDownloadStream(b64ResourceId, headUrl, getUrl, downloadChunkSize);

    const { metadata: encryptedMetadata, encryptedContentLength } = await downloader.getMetadata();
    const { encryptionFormat, ...resourceMetadata } = await this._decryptMetadata(encryptedMetadata);

    const decryptor = await this._dataProtector.createDecryptionStream();

    // SDKs up to v2.2.1 did not set an encryption format in the metadata
    if (encryptionFormat) {
      const clearSize = getClearSize(encryptionFormat, encryptedContentLength);
      const progressHandler = new ProgressHandler(progressOptions).start(clearSize);
      decryptor.on('data', (chunk: Uint8Array) => progressHandler.report(chunk.byteLength));
    }

    const streams = [downloader, decryptor];

    return new DownloadStream(streams, resourceMetadata);
  }
}

export default CloudStorageManager;
