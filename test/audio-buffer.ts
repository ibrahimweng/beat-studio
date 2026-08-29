/**
 * Just enough AudioBuffer for the encoders to read.
 *
 * Node has no Web Audio, and the encoders do not need it. Between them they
 * touch four members: how many channels there are, how long it is, what rate
 * it was made at, and the samples themselves. That is worth knowing on its
 * own, because it is the reason these two files can be tested at all while
 * the graph that fills them cannot.
 *
 * Deliberately strict about a channel that is not there. The real thing
 * throws, and a stub that quietly returns nothing would turn a test's own
 * mistake into a passing assertion about silence.
 */
export function audioBuffer(
  channels: readonly (readonly number[])[],
  sampleRate = 48_000,
): AudioBuffer {
  const data = channels.map((samples) => Float32Array.from(samples));
  const length = data.length ? data[0].length : 0;

  for (const channel of data) {
    if (channel.length !== length) {
      throw new Error('every channel has to be the same length');
    }
  }

  return {
    numberOfChannels: data.length,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData(index: number): Float32Array {
      const channel = data[index];
      if (!channel) throw new Error(`no channel ${index}`);
      return channel;
    },
  } as unknown as AudioBuffer;
}

/** A run of samples from a function of the sample number. */
export function ramp(count: number, at: (i: number) => number): number[] {
  return Array.from({ length: count }, (_, i) => at(i));
}
