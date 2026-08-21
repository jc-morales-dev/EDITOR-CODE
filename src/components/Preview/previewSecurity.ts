export const PREVIEW_SANDBOX = 'allow-scripts';

type PreviewError = {
  type: 'preview-error';
  file: string;
  message: string;
};

export function isPreviewErrorMessage(
  event: MessageEvent,
  expectedSource: Window | null,
): event is MessageEvent<PreviewError> {
  if (!expectedSource || event.source !== expectedSource) return false;

  const data = event.data as Partial<PreviewError> | null;
  return Boolean(
    data &&
      data.type === 'preview-error' &&
      typeof data.file === 'string' &&
      data.file.length > 0 &&
      data.file.length <= 260 &&
      typeof data.message === 'string' &&
      data.message.length > 0 &&
      data.message.length <= 2000,
  );
}
