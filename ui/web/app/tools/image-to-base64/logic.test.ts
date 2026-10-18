// happy-dom implements FileReader and atob/btoa, so unlike the canvas-based tools in this
// cluster, the whole round trip (encode AND decode) is testable here — nothing needs a real
// canvas or a browser lane.
import { describe, expect, it } from 'vitest';
import {
  cssBackgroundImage,
  cssUrlFunction,
  dataUriToBlob,
  encodeImageFile,
  extensionFromMime,
  fileToDataUri,
  htmlImgTag,
  markdownImage,
  parseDataUri,
} from './logic';

// A 1×1 transparent PNG, the smallest valid PNG there is.
const PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
);

function pngFile(name = 'pixel.png'): File {
  return new File([PNG_BYTES], name, { type: 'image/png' });
}

describe('fileToDataUri / encodeImageFile', () => {
  it('produces a base64 PNG data URI that round-trips back to the same bytes', async () => {
    const encoded = await encodeImageFile(pngFile());
    expect(encoded.dataUri).toMatch(/^data:image\/png;base64,/);
    expect(encoded.mime).toBe('image/png');
    expect(encoded.sizeBefore).toBe(PNG_BYTES.length);
    const blob = dataUriToBlob(encoded.dataUri);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(PNG_BYTES));
  });

  it('rejects a file whose declared type is not an image', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' });
    await expect(encodeImageFile(file)).rejects.toMatchObject({
      code: 'notAnImage',
      params: { name: 'notes.txt', mime: 'text/plain' },
    });
  });

  it('allows a file with no declared type through — FileReader does not need one', async () => {
    const file = new File([PNG_BYTES], 'pixel', { type: '' });
    const encoded = await encodeImageFile(file);
    expect(encoded.dataUri.startsWith('data:')).toBe(true);
  });

  it('reads arbitrary bytes as a data URI regardless of content', async () => {
    const uri = await fileToDataUri(pngFile());
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('parseDataUri', () => {
  it('extracts the MIME type and base64 payload', () => {
    expect(parseDataUri('data:image/png;base64,AAAA')).toEqual({
      mime: 'image/png',
      base64: 'AAAA',
    });
  });

  it('strips whitespace/newlines a copy-paste can introduce', () => {
    expect(parseDataUri('data:image/png;base64,AA\nAA ')).toEqual({
      mime: 'image/png',
      base64: 'AAAA',
    });
  });

  it('rejects a string with no "data:" prefix', () => {
    expect(() => parseDataUri('not a data uri')).toThrow(
      expect.objectContaining({ code: 'badDataUri' }),
    );
  });

  it('rejects a data URI without the ";base64" flag', () => {
    expect(() => parseDataUri('data:image/svg+xml,<svg/>')).toThrow(
      expect.objectContaining({ code: 'notBase64DataUri' }),
    );
  });

  it('rejects a data URI whose type is not an image', () => {
    expect(() => parseDataUri('data:text/plain;base64,AAAA')).toThrow(
      expect.objectContaining({ code: 'dataUriNotImage', params: { mime: 'text/plain' } }),
    );
  });
});

describe('dataUriToBlob', () => {
  it('rejects base64 that will not decode', () => {
    expect(() => dataUriToBlob('data:image/png;base64,not-valid-base64!!!')).toThrow(
      expect.objectContaining({ code: 'badBase64' }),
    );
  });
});

describe('extensionFromMime', () => {
  it('maps known image types', () => {
    expect(extensionFromMime('image/png')).toBe('png');
    expect(extensionFromMime('image/jpeg')).toBe('jpg');
    expect(extensionFromMime('image/svg+xml')).toBe('svg');
  });

  it('falls back to a generic extension for anything unrecognised', () => {
    expect(extensionFromMime('image/x-made-up')).toBe('bin');
  });
});

describe('paste-ready snippets', () => {
  const uri = 'data:image/png;base64,AAAA';

  it('builds an HTML <img> tag', () => {
    expect(htmlImgTag(uri)).toBe('<img src="data:image/png;base64,AAAA" alt="" />');
  });

  it('builds a CSS background-image declaration', () => {
    expect(cssBackgroundImage(uri)).toBe('background-image: url("data:image/png;base64,AAAA");');
  });

  it('builds a bare CSS url()', () => {
    expect(cssUrlFunction(uri)).toBe('url("data:image/png;base64,AAAA")');
  });

  it('builds a Markdown image', () => {
    expect(markdownImage(uri)).toBe('![image](data:image/png;base64,AAAA)');
  });
});
