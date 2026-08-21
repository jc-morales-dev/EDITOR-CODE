import { describe, expect, it } from 'vitest';
import { PREVIEW_SANDBOX, isPreviewErrorMessage } from './previewSecurity';

describe('preview sandbox', () => {
  it('permite scripts sin compartir el origen ni abrir ventanas', () => {
    expect(PREVIEW_SANDBOX.split(/\s+/)).toEqual(['allow-scripts']);
  });
});

describe('isPreviewErrorMessage', () => {
  const previewWindow = {} as Window;

  it('acepta errores únicamente desde el iframe esperado', () => {
    const event = {
      source: previewWindow,
      data: { type: 'preview-error', file: 'app.js', message: 'boom' },
    } as unknown as MessageEvent;

    expect(isPreviewErrorMessage(event, previewWindow)).toBe(true);
    expect(isPreviewErrorMessage(event, {} as Window)).toBe(false);
  });

  it('rechaza mensajes malformados o excesivos', () => {
    const malformed = {
      source: previewWindow,
      data: { type: 'preview-error', file: 'app.js', message: 'x'.repeat(2001) },
    } as unknown as MessageEvent;

    expect(isPreviewErrorMessage(malformed, previewWindow)).toBe(false);
  });
});
