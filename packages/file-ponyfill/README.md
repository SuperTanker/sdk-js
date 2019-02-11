# A cross-browser ponyfill for File

## Why

A common issue with the JavaScript `File` class is the lack of [a constructor](https://developer.mozilla.org/en-US/docs/Web/API/File/File) in [some browsers](https://developer.mozilla.org/en-US/docs/Web/API/File/File#Browser_compatibility):

```javascript
new File(['Hi!'], 'file.txt'); // will throw in Edge and Internet Explorer
```

Using feature detection, this package will either expose a `File` ponyfill in browsers lacking a proper constructor, or the native `File` class in others.

## Usage

You can safely use this package as a drop-in replacement for the native `File` class in all browsers, e.g.:

```javascript
import FilePonyfill from '@tanker/file-ponyfill';

// Get bits from whatever method you want, using fetch() as an example
const response = await fetch('https://your.server.com/path/to/a/report.pdf');
const bits = [await response.arrayBuffer()];

// Construct a file in a cross-browser fashion
const file = new FilePonyfill(bits, 'report.pdf', { type: 'application/pdf' });

// Check what we've got
file instanceof window.Blob; // true
file instanceof window.File; // true
file instanceof FilePonyfill; // true
file.name; // 'report.pdf'
file.type; // 'application/pdf'
file.size; // the size of report.pdf
```

Note that the ponyfill is built using a clever class hierarchy so that instances will appear as regular `File` and `Blob` instances, which can safely be read by a `FileReader` and used with other APIs working with files.

## License

Developped by [Tanker](https://tanker.io), under the [Apache-2.0](http://www.apache.org/licenses/LICENSE-2.0) license.

Tanker allows seamless integration of end-to-end encryption in your application.

Read the [documentation](https://tanker.io/docs/latest/) to get started.

Go to [tanker.io](https://tanker.io) for more informations about Tanker.
