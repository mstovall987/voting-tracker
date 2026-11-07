// Loads the JSON files written by the pipeline (web/data/...) and caches them for the session.

const cache = new Map();

export function getJSON(path) {
  if (!cache.has(path)) {
    const promise = fetch(`data/${path}`, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`Could not load data/${path} (HTTP ${r.status}).`);
      return r.json();
    });
    promise.catch(() => cache.delete(path)); // allow a retry after a failure
    cache.set(path, promise);
  }
  return cache.get(path);
}

const SHARD_SIZE = 50; // must match pipeline/export.py

export const senate = {
  meta: () => getJSON('senate/meta.json'),
  senators: () => getJSON('senate/senators.json'),
  votes: () => getJSON('senate/votes.json'),
  recent: () => getJSON('senate/recent.json'),
  topics: () => getJSON('senate/topics.json'),
  billIndex: () => getJSON('senate/bills/index.json'),
  member: (id) => getJSON(`senate/members/${id}.json`),
  async bill(id) {
    const m = /^([a-z]+)(\d+)-\d+$/.exec(id);
    if (!m) return null;
    const shard = await getJSON(`senate/bills/detail/${m[1]}-${Math.floor(Number(m[2]) / SHARD_SIZE)}.json`);
    return shard[id] || null;
  },
};

let byId = null;
/** Map of bioguide id -> senator summary (everyone who served this Congress). */
export async function senatorsById() {
  if (!byId) {
    const list = await senate.senators();
    byId = new Map(list.map((s) => [s.id, s]));
  }
  return byId;
}

/** Index of each senator within votes.json's position strings. */
let posIndex = null;
export async function votePositionIndex() {
  if (!posIndex) {
    const data = await senate.votes();
    posIndex = new Map(data.members.map((id, i) => [id, i]));
  }
  return posIndex;
}
