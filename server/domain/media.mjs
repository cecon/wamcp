export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

export class MediaError extends Error {}

export function checkMediaSize(size) {
  if (size > MAX_MEDIA_BYTES) throw new MediaError('O anexo excede o limite de 10 MiB por consulta.');
}
