import he from 'he';

export type EncodeOptions = {
  encodeEverything?: boolean;
  useNamedReferences?: boolean;
};

export function encodeHtml(text: string, options: EncodeOptions = {}): string {
  return he.encode(text, {
    encodeEverything: options.encodeEverything ?? false,
    useNamedReferences: options.useNamedReferences ?? true,
  });
}

export function decodeHtml(html: string): string {
  return he.decode(html);
}
