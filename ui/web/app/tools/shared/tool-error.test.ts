import { describe, expect, it } from 'vitest';
import { ToolError, toolErrorText } from './tool-error';

describe('toolErrorText', () => {
  const strings = { error_notHexDigit: '"{char}" không phải chữ số hex', other: 'x' };

  it('renders the localized template with the params filled in', () => {
    const e = new ToolError('notHexDigit', '"g" is not a hex digit', { char: 'g' });
    expect(toolErrorText(e, strings, 'fallback')).toBe('"g" không phải chữ số hex');
  });

  it('falls back to the English message for a code the table lacks', () => {
    const e = new ToolError('unknownCode', 'Something specific', {});
    expect(toolErrorText(e, strings, 'fallback')).toBe('Something specific');
  });

  it('passes plain errors through and uses the fallback for non-errors', () => {
    expect(toolErrorText(new Error('boom'), strings, 'fallback')).toBe('boom');
    expect(toolErrorText('boom', strings, 'fallback')).toBe('fallback');
  });

  it('keeps the English message as Error.message so existing assertions still hold', () => {
    const e = new ToolError('x', 'Invalid Base64 input');
    expect(e.message).toBe('Invalid Base64 input');
    expect(e).toBeInstanceOf(Error);
  });
});
