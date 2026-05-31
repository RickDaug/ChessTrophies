// Goofy guest-name generator + in-memory per-session reservation registry.
// Names combine large word pools (adjective x animal x number) yielding tens
// of millions of distinct live combinations -- scales well past a million
// concurrent guests. A name is reserved only while a guest session is active.
// Reservations live in memory (no database, no persistence) and auto-expire
// via TTL. Nothing about a guest is ever written to disk.

const ADJECTIVES = ['Wobbly','Sneaky','Bouncy','Grumpy','Sleepy','Snazzy','Wiggly','Zany','Goofy','Cheeky','Bumbling','Dizzy','Fluffy','Soggy','Sparkly','Cranky','Chunky','Quirky','Loopy','Spunky','Jolly','Plucky','Nifty','Zesty','Funky','Peppy','Wacky','Silly','Clumsy','Giggly','Snappy','Frosty','Toasty','Squishy','Noodly','Bubbly','Crispy','Drowsy','Feisty','Goopy','Hasty','Itchy','Jumbo','Kooky','Lumpy','Mighty','Nimble','Ornery','Perky','Rowdy','Sassy','Tipsy','Uppity','Whiny','Yappy','Zippy','Brawny','Cozy','Daffy','Eager','Frumpy','Gangly','Hefty','Jaunty','Knobbly','Limber','Mopey','Nutty','Oafish','Pudgy','Rascally','Scruffy','Tubby','Unruly','Vivid','Woozy','Zealous','Spiffy','Goober','Bonkers'];
const ANIMALS = ['Penguin','Walrus','Otter','Llama','Hedgehog','Platypus','Narwhal','Pangolin','Capybara','Wombat','Sloth','Lemur','Meerkat','Mongoose','Ferret','Badger','Beaver','Raccoon','Possum','Armadillo','Hamster','Gerbil','Chinchilla','Quokka','Axolotl','Tapir','Okapi','Aardvark','Manatee','Dugong','Pufferfish','Blobfish','Catfish','Jellyfish','Seahorse','Starfish','Octopus','Squid','Cuttlefish','Crab','Flamingo','Pelican','Toucan','Puffin','Kiwi','Dodo','Emu','Ostrich','Cassowary','Kookaburra','Newt','Salamander','Gecko','Iguana','Chameleon','Tortoise','Bullfrog','Tadpole','Komodo','Boa','Yak','Alpaca','Bison','Moose','Elk','Caribou','Ibex','Gazelle','Wildebeest','Warthog','Hippo','Rhino','Mammoth','Wallaby','Kangaroo','Koala','Dingo','Numbat','Bilby','Tamandua'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export const BASE_COMBOS = ADJECTIVES.length * ANIMALS.length;

const reservations = new Map();
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 2;

function sweepExpired(now) {
  now = now || Date.now();
  for (const [name, expiry] of reservations) { if (expiry <= now) reservations.delete(name); }
}
function buildCandidate() {
  return pick(ADJECTIVES) + pick(ANIMALS) + (Math.floor(Math.random() * 9999) + 1);
}
export function assignGuestName(ttlMs) {
  sweepExpired();
  const expiry = Date.now() + (ttlMs || DEFAULT_TTL_MS);
  for (let i = 0; i < 50; i++) {
    const c = buildCandidate();
    if (!reservations.has(c)) { reservations.set(c, expiry); return c; }
  }
  const fb = buildCandidate() + 'x' + Date.now().toString(36);
  reservations.set(fb, expiry);
  return fb;
}
export function releaseGuestName(name) { if (name) reservations.delete(name); }
export function activeGuestCount() { sweepExpired(); return reservations.size; }
