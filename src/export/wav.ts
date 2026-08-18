/**
 * Encode an AudioBuffer as a 16-bit PCM WAV file.
 *
 * Written by hand because the platform has no encoder: browsers can decode
 * many formats but only ever hand back raw samples.
 */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const dataBytes = frames * channels * bytesPerSample;

  const view = new DataView(new ArrayBuffer(44 + dataBytes));
  const writeText = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  // RIFF header
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, 'WAVE');

  // fmt chunk — 16 bytes, format 1 (uncompressed PCM)
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true); // byte rate
  view.setUint16(32, channels * bytesPerSample, true); // block align
  view.setUint16(34, 8 * bytesPerSample, true);

  // data chunk
  writeText(36, 'data');
  view.setUint32(40, dataBytes, true);

  const source: Float32Array[] = [];
  for (let c = 0; c < channels; c++) source.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, source[c][i]));
      // Negative and positive full scale are not symmetric in 16-bit PCM.
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([view], { type: 'audio/wav' });
}
