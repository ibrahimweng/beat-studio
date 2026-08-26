/**
 * How many bits each sample is written with.
 *
 * 24 is what post production expects and what everything here writes by
 * default. The difference is not loudness but how much room there is under
 * the loudest moment: at 16 bits the quietest detail in a piece sits close to
 * the noise the format itself introduces, and anyone who then lowers the
 * track to fit it under a voiceover brings that noise up with it. 16 remains
 * for anywhere a file has to be as small as possible.
 */
export type BitDepth = 16 | 24;

/**
 * Encode an AudioBuffer as a PCM WAV file.
 *
 * Written by hand because the platform has no encoder: browsers can decode
 * many formats but only ever hand back raw samples.
 */
export function encodeWav(buffer: AudioBuffer, bits: BitDepth = 24): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = bits / 8;
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
  view.setUint16(34, bits, true);

  // data chunk
  writeText(36, 'data');
  view.setUint32(40, dataBytes, true);

  const source: Float32Array[] = [];
  for (let c = 0; c < channels; c++) source.push(buffer.getChannelData(c));

  // Negative and positive full scale are not symmetric in PCM: there is one
  // more step below zero than above it.
  const floor = bits === 24 ? 0x800000 : 0x8000;
  const ceiling = bits === 24 ? 0x7fffff : 0x7fff;

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, source[c][i]));
      const value = Math.round(sample < 0 ? sample * floor : sample * ceiling);
      if (bits === 24) {
        // No setInt24, so the three bytes go out smallest first by hand.
        view.setUint8(offset, value & 0xff);
        view.setUint8(offset + 1, (value >> 8) & 0xff);
        view.setUint8(offset + 2, (value >> 16) & 0xff);
      } else {
        view.setInt16(offset, value, true);
      }
      offset += bytesPerSample;
    }
  }

  return new Blob([view], { type: 'audio/wav' });
}
