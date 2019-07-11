// @flow
import { errors } from '@tanker/core';

import type { Data } from './dataHelpers';

type HTTPMethod = 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT';

type RequestOptions = $Exact<{
  method: HTTPMethod,
  responseType: 'arraybuffer' | 'blob' | 'text',
  headers?: Object,
  body?: Data | null,
}>;

const parseHeaders = (rawHeaders: Object) => {
  const headers = {};
  // Replace instances of \r\n and \n followed by at least one space or horizontal tab with a space
  // https://tools.ietf.org/html/rfc7230#section-3.2
  const preProcessedHeaders = rawHeaders.replace(/\r?\n[\t ]+/g, ' ');
  preProcessedHeaders.split(/\r?\n/).forEach(line => {
    const parts = line.split(':');
    const key = parts.shift().trim();
    if (key) {
      const value = parts.join(':').trim();
      headers[key] = value;
    }
  });
  return headers;
};

const defaultOpts = { method: 'GET', responseType: 'text', body: null, headers: {} };

export const simpleFetch = (url: string, opts: RequestOptions) => {
  const { method, responseType, headers, body } = { ...defaultOpts, ...opts };

  const xhr = new XMLHttpRequest();
  xhr.open(method, url, true);
  xhr.responseType = responseType;

  Object.keys(headers).forEach(key => {
    xhr.setRequestHeader(key, headers[key]);
  });

  return new Promise((resolve, reject) => {
    xhr.onload = () => {
      const { status } = xhr;
      const ok = status >= 200 && status < 300;
      const responseBody = 'response' in xhr ? xhr.response : xhr.responseText;
      const response = {
        ok,
        status,
        statusText: xhr.statusText,
        body: responseBody,
        headers: parseHeaders(xhr.getAllResponseHeaders() || ''),
      };
      resolve(response);
    };

    xhr.onabort = () => reject(new errors.NetworkError('Request aborted'));
    xhr.onerror = () => reject(new errors.NetworkError('Request failed'));
    xhr.ontimeout = () => reject(new errors.NetworkError('Request timeouted'));

    xhr.send(body);
  });
};
