/** Samples per MPEG frame — lamejs expects input in blocks of this size. */
const BLOCK_SIZE = 1152;
const BITRATE_KBPS = 192;

/** Convert float samples to the signed 16-bit PCM lamejs wants. */
function toInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = Math.max(-1, Math.min(1, input[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

/**
 * Encode an AudioBuffer as MP3.
 *
 * The encoder is a sizeable dependency and only needed when someone actually
 * exports, so it is imported on demand and code-split out of the main bundle.
 * Returns null if the encoder cannot be loaded, letting the caller fall back
 * to WAV rather than failing the export.
 */
export async function encodeMp3(buffer: AudioBuffer): Promise<Blob | null> {
  let lamejs: typeof import('@breezystack/lamejs');
  try {
    lamejs = await import('@breezystack/lamejs');
  } catch {
    return null;
  }

  const channels = Math.min(2, buffer.numberOfChannels);
  const encoder = new lamejs.Mp3Encoder(channels, buffer.sampleRate, BITRATE_KBPS);

  const left = toInt16(buffer.getChannelData(0));
  const right = channels > 1 ? toInt16(buffer.getChannelData(1)) : null;

  const parts: Int8Array[] = [];
  for (let i = 0; i < left.length; i += BLOCK_SIZE) {
    const chunk = right
      ? encoder.encodeBuffer(left.subarray(i, i + BLOCK_SIZE), right.subarray(i, i + BLOCK_SIZE))
      : encoder.encodeBuffer(left.subarray(i, i + BLOCK_SIZE));
    if (chunk.length) parts.push(new Int8Array(chunk));
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Int8Array(tail));

  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
}
