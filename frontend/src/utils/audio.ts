/** 音频工具：后端试听接口返回 hex 编码的音频，需要还原成可播放的 Blob */

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * 播放 hex 编码的 WAV 音频，播放结束（或失败）后 resolve。
 * @returns 是否成功播放
 */
export async function playHexAudio(hex: string): Promise<boolean> {
  if (!hex) return false;

  const url = URL.createObjectURL(new Blob([hexToBytes(hex)], { type: 'audio/wav' }));
  const audio = new Audio(url);
  const cleanup = () => {
    audio.onended = null;
    audio.onerror = null;
    URL.revokeObjectURL(url);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('音频播放失败'));
      audio.play().catch(reject);
    });
    cleanup();
    return true;
  } catch {
    cleanup();
    return false;
  }
}
