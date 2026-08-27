import type { DesignName } from '../timeline/types.ts';

/**
 * The words the app knows, and what each of them means.
 *
 * One table rather than two, because the library's search and the description
 * engine are asking the same question — what did this person mean — and the
 * worst way to answer it twice is with two lists that drift apart. Adding a
 * word here teaches both of them at once.
 *
 * Everything is lower case and matched whole. Two word entries are matched as
 * a pair before the words are looked at singly, so "wind up" reaches the
 * ratchet without "up" meaning anything on its own.
 */

/**
 * Words that name a voice without being its name.
 *
 * Guessing at what somebody else called things is most of what using a sound
 * library is, and nobody types "ratchet" when they mean the wind-up sound.
 * These are the words they type instead.
 */
export const SYNONYMS: Record<DesignName, readonly string[]> = {
  // ---------- hits ----------
  impact: ['hit', 'boom', 'punch', 'bang', 'blow', 'strike', 'smash', 'crash', 'whack',
    'explosion', 'explode', 'blast', 'gunshot', 'shot', 'detonation', 'slap'],
  thud: ['hit', 'body', 'dull', 'bump', 'thump', 'muffled', 'landing', 'fall',
    'heartbeat', 'punch', 'drop', 'flesh'],
  slam: ['door', 'hit', 'heavy', 'shut', 'bang', 'closing', 'stomp', 'gate', 'lid'],
  metal: ['clang', 'steel', 'iron', 'metallic', 'ring', 'gong', 'sheet', 'anvil',
    'sword', 'blade', 'girder', 'hammer'],
  clank: ['metal', 'knock', 'metallic', 'rattle', 'chain', 'pipe', 'clunk'],

  // ---------- movement ----------
  whoosh: ['swish', 'pass', 'air', 'sweep', 'swoosh', 'wind', 'fly', 'past', 'transition',
    'flyby', 'gust', 'wave', 'rocket', 'launch'],
  swipe: ['swish', 'fast', 'air', 'slash', 'cut', 'slice', 'blade', 'wipe', 'whip', 'swing'],
  flutter: ['wings', 'flap', 'air', 'bird', 'paper', 'rustle', 'leaves'],
  wobble: ['warp', 'bend', 'waver', 'warble', 'unstable', 'wonky', 'drunk', 'tape', 'wow'],

  // ---------- lead in ----------
  riser: ['build', 'lead in', 'tension', 'rise', 'ramp', 'uplifter', 'into', 'approach'],
  swell: ['build', 'lead in', 'grow', 'crescendo', 'bloom', 'rise'],
  reverse: ['backwards', 'suck', 'lead in', 'reversed', 'inhale', 'pull', 'rewind'],

  // ---------- low end ----------
  sub: ['bass', 'low', 'drop', 'deep', 'boom', 'weight', 'bottom'],
  rumble: ['low', 'earth', 'thunder', 'quake', 'earthquake', 'roll', 'landslide',
    'explosion', 'avalanche', 'collapse', 'tremor'],
  drone: ['hum', 'low', 'bed', 'tone', 'sustained', 'ambience', 'atmosphere'],

  // ---------- detail ----------
  click: ['tick', 'ui', 'button', 'press', 'tap', 'select', 'interface',
    'typing', 'keyboard', 'key', 'shutter', 'camera', 'switch'],
  tick: ['click', 'ui', 'count', 'tock', 'step', 'counter'],
  pop: ['blip', 'ui', 'bubble', 'burst', 'cork', 'blob'],
  beep: ['tone', 'ui', 'alert', 'signal', 'notification', 'confirm', 'ping',
    'alarm', 'buzzer', 'message', 'success'],
  chirp: ['blip', 'ui', 'bird', 'tweet', 'squeak', 'peep'],

  // ---------- texture ----------
  zap: ['laser', 'electric', 'sci fi', 'shock', 'energy', 'blast', 'beam', 'ray'],
  glitch: ['digital', 'error', 'broken', 'stutter', 'corrupt', 'data', 'fault', 'malfunction'],
  shimmer: ['sparkle', 'magic', 'bright', 'twinkle', 'glitter', 'fairy', 'stars', 'reveal'],
  static: ['noise', 'hiss', 'radio', 'interference', 'tv', 'signal', 'white noise',
    'steam', 'vinyl', 'tape', 'wash'],

  // ---------- struck ----------
  bell: ['chime', 'ring', 'church', 'gong', 'tone', 'bowl', 'triangle'],
  glass: ['crystal', 'ring', 'ping', 'glassy', 'bottle', 'window',
    'shatter', 'shattering', 'smash', 'break', 'breaking', 'coin'],
  wood: ['block', 'knock', 'dry', 'wooden', 'clave', 'stick', 'plank',
    'snap', 'crack', 'bone', 'branch', 'table'],
  pipe: ['tube', 'hollow', 'organ', 'flute', 'blow', 'vent', 'duct'],

  // ---------- plucked ----------
  string: ['pluck', 'guitar', 'harp', 'plucked', 'strum', 'banjo', 'koto'],
  thunk: ['knock', 'dull', 'hollow', 'box', 'carton', 'crate'],
  wire: ['twang', 'cable', 'tension', 'spring', 'boing', 'sproing'],

  // ---------- grains ----------
  rain: ['water', 'weather', 'drops', 'drizzle', 'shower', 'patter', 'dripping', 'drip'],
  fire: ['crackle', 'burn', 'flames', 'sizzle', 'campfire', 'embers', 'burning'],
  gravel: ['stones', 'scrape', 'dirt', 'rubble', 'crunch', 'footsteps', 'footstep',
    'debris', 'grit', 'scratch', 'sand', 'walking'],
  swarm: ['insects', 'bees', 'sci fi', 'buzz', 'flies', 'wasps', 'locusts'],
  pour: ['water', 'bubbles', 'liquid', 'splash', 'drink', 'stream', 'glug'],

  // ---------- mechanical ----------
  ratchet: ['clatter', 'gear', 'wind up', 'crank', 'cog', 'winding', 'reel'],
  clockwork: ['ticking', 'clock', 'gears', 'mechanism', 'watch', 'timer'],
  zip: ['zipper', 'fast', 'lead in', 'unzip', 'rip', 'tear'],
  motor: ['engine', 'machine', 'idle', 'drill', 'whirr', 'servo', 'robot', 'motorised',
    'helicopter', 'rotor', 'elevator', 'fan', 'turbine'],
};

/**
 * How big the thing is, from tiny at one to huge at minus one.
 *
 * Signed rather than a lookup of pitches and lengths, because size is one
 * idea: a large object is lower and rings for longer, and the two have to
 * move together or you get the same object played wrong.
 */
export const SIZE: Readonly<Record<string, number>> = {
  minuscule: 1, microscopic: 1, tiny: 1, tiniest: 1,
  miniature: 0.85, small: 0.7, little: 0.7, slight: 0.6, thin: 0.6, light: 0.5,
  narrow: 0.5, delicate: 0.6, fine: 0.5, dainty: 0.7, petite: 0.75,
  medium: 0, normal: 0, ordinary: 0, plain: 0,
  big: -0.6, large: -0.6, heavy: -0.6, fat: -0.6, thick: -0.5, wide: -0.5,
  broad: -0.5, deep: -0.7, low: -0.7, bulky: -0.65, weighty: -0.6,
  huge: -0.85, massive: -0.9, enormous: -0.9, giant: -0.9, gigantic: -0.9,
  colossal: -1, vast: -0.85, immense: -0.9, monstrous: -0.9, titanic: -1,
  high: 0.7,
};

/**
 * How long it runs, as a multiple of the voice's own length.
 *
 * Separate from size, because "a huge quick hit" is a real thing to ask for
 * and folding the two together would make it impossible to say.
 */
export const LENGTH: Readonly<Record<string, number>> = {
  instant: 0.25, instantaneous: 0.25, immediate: 0.4, stab: 0.4, blip: 0.35,
  quick: 0.5, fast: 0.6, short: 0.55, snappy: 0.5, brief: 0.5, tight: 0.6,
  clipped: 0.45, abrupt: 0.5, sudden: 0.5, punchy: 0.6, rapid: 0.5,
  long: 2, sustained: 2.5, slow: 2, drawn: 2.2, lingering: 2.5, extended: 2.2,
  endless: 3, lasting: 2, prolonged: 2.4, protracted: 2.4, ringing: 1.8,
};

/**
 * How much room is around it.
 *
 * A room and a distance are the same control here: something far away is
 * mostly the room between you and it, which is why "distant" sits up with the
 * halls rather than down with the dry.
 */
export const PLACE: Readonly<Record<string, number>> = {
  dry: 0, dead: 0, anechoic: 0, direct: 0, flat: 0, booth: 0.05,
  tight: 0.06, close: 0.2, near: 0.2, nearby: 0.2, intimate: 0.15,
  studio: 0.3, room: 0.45, indoors: 0.45, indoor: 0.45, office: 0.4,
  corridor: 0.55, hallway: 0.55, roomy: 0.55, outside: 0.5, outdoors: 0.5,
  ambient: 0.6, spacious: 0.7, hall: 0.7, echo: 0.7, echoing: 0.75,
  echoey: 0.75, reverb: 0.65, reverberant: 0.8, wet: 0.7, warehouse: 0.8,
  church: 0.8, tunnel: 0.85, arena: 0.85, distant: 0.8, far: 0.8, faraway: 0.8,
  away: 0.7, cathedral: 0.9, canyon: 0.95, stadium: 0.9, cave: 1, cavern: 1,
  cavernous: 1,
};

/** How hard it is pushed. */
export const PUSH: Readonly<Record<string, number>> = {
  clean: 0, soft: 0, gentle: 0, subtle: 0, polite: 0, pure: 0,
  smooth: 0.05, mellow: 0.05, warm: 0.2, driven: 0.5, pushed: 0.5, cranked: 0.7,
  hard: 0.55, punchy: 0.5, crunchy: 0.7, gritty: 0.7, grungy: 0.7, dirty: 0.65,
  harsh: 0.7, rough: 0.6, raw: 0.6, saturated: 0.75, overdriven: 0.8,
  aggressive: 0.8, fierce: 0.8, nasty: 0.75, angry: 0.8, brutal: 0.9,
  violent: 0.85, distorted: 0.85, destroyed: 0.95, crushed: 0.9, savage: 0.9,
};

/**
 * How loud it arrives, as the level any sound arrives at times this.
 *
 * The most obvious thing anybody says about a sound and the last axis to be
 * added here, because it is the one the library never varies: a size and a
 * place are what a sound is, and a level is what you did to it. The
 * describer varies it anyway, since "a quiet click" is a normal thing to ask
 * for and having no answer to it was a hole rather than a principle.
 *
 * Only words that are actually about level. "Huge" and "big" were in here at
 * first, on the reasoning that a huge thing is louder, and the effect was
 * that asking for a huge slam quietly turned the level up as well as the size
 * — three things moving off one word, one of them unasked for. A size is a
 * size; the Level slider is right there.
 */
export const LOUD: Readonly<Record<string, number>> = {
  inaudible: 0.15, whisper: 0.25, whispered: 0.25, faint: 0.3, quiet: 0.4,
  hushed: 0.4, soft: 0.55, gentle: 0.6, muted: 0.5, background: 0.4,
  loud: 1.25, strong: 1.2, powerful: 1.3, booming: 1.35, thunderous: 1.4,
  blaring: 1.4, deafening: 1.5, roaring: 1.4,
};

/**
 * How bright it is, in semitones on top of whatever size asked for.
 *
 * Brightness is not a control of its own here — the voices are filtered by
 * where they sit, so moving one up the scale is what makes it thinner and
 * moving it down is what makes it duller. Smaller than the size numbers on
 * purpose: "a bright huge bell" should still be a huge bell.
 */
export const TONE: Readonly<Record<string, number>> = {
  bright: 5, brighter: 5, sharp: 4, crisp: 4, clear: 3, glassy: 4, icy: 5,
  piercing: 7, shrill: 7, tinny: 6, brittle: 5, sparkly: 5, airy: 4,
  dull: -4, dark: -5, darker: -5, muffled: -6, muted: -5, murky: -5,
  woolly: -5, boomy: -4, round: -3, soft: -2, mellow: -3, warm: -3,
};

/**
 * Words that scale whichever word comes after them.
 *
 * "Very" on its own means nothing; it means whatever the next word meant,
 * more so. Applied to the word that follows rather than the sentence, so
 * "very quick and slightly dark" moves two things by two different amounts.
 */
export const AMOUNT: Readonly<Record<string, number>> = {
  insanely: 1.8, ridiculously: 1.8, extremely: 1.7, ultra: 1.7, incredibly: 1.7,
  super: 1.5, really: 1.4, very: 1.4, quite: 1.2, pretty: 1.2, fairly: 1.1,
  so: 1.3, absolutely: 1.6, totally: 1.5, seriously: 1.5,
  somewhat: 0.6, slightly: 0.5, mildly: 0.5, faintly: 0.4, subtly: 0.4,
  barely: 0.3, hardly: 0.3, gently: 0.5, softly: 0.5,
};

/** Words that cancel whichever dimension the next word belongs to. */
export const NEGATORS: readonly string[] = ['no', 'not', 'without', 'none', 'zero', 'never'];

/**
 * Words worth nothing, and worth not complaining about.
 *
 * The engine reports back the words it did not understand, which is how
 * anybody finds out what it does understand. That list is only useful if it
 * is short, so the words nobody expected it to know are dropped rather than
 * listed.
 */
export const FILLER: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or',
  'but', 'is', 'it', 'its', 'as', 'be', 'that', 'this', 'these', 'those',
  'some', 'any', 'my', 'your', 'i', 'want', 'need', 'make', 'made', 'give',
  'sound', 'sounds', 'sfx', 'effect', 'effects', 'noise', 'like', 'kind',
  'sort', 'something', 'thing', 'please', 'can', 'you', 'me', 'from', 'into',
  'onto', 'over', 'under', 'up', 'down', 'out', 'off', 'by', 'one', 'bit',
  'more', 'less', 'too', 'than', 'then', 'there', 'here', 'when', 'while',
]);

/**
 * What a word is worth in one of the tables above, or null if it is not in it.
 *
 * A word is looked up in every table, and being in more than one is normal
 * rather than a clash to resolve. "Low" is a size and also names the sub;
 * "dry" is a place and also names the wood block; "warm" is both a gentle
 * push and a dull tone. That overlap is the reason the engine works at all:
 * "low boom" should pick a low voice and pitch it down, not choose between
 * the two readings.
 */
export function meaning(table: Readonly<Record<string, number>>, word: string): number | null {
  return Object.prototype.hasOwnProperty.call(table, word) ? table[word] : null;
}
