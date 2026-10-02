import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { checkMediaSize, MediaError } from '../../domain/media.mjs';

export async function downloadMedia(message, context, download = downloadMediaMessage, timeoutMs = 30000) {
  let stream;
  let expired = false;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      stream?.destroy();
      reject(new MediaError('O download demorou demais. Tente consultar o anexo novamente.'));
    }, timeoutMs);
  });
  const read = async () => {
    stream = await download(message, 'stream', {}, context);
    if (expired) {
      stream.destroy();
      return;
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of stream) {
        size += chunk.length;
        checkMediaSize(size);
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('base64');
    } finally {
      stream.destroy();
    }
  };
  try {
    return await Promise.race([read(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
