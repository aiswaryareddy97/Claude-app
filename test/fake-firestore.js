// In-memory Firestore stand-in. The data itself lives in the Node test
// process (via __fsRead/__fsWrite) so several browser pages can act as
// separate devices sharing one backend — which is the whole point when
// testing Player IDs.

const ARRAY_UNION = "__arrayUnion";
const DELETE_FIELD = "__deleteField";

export class Timestamp {
  constructor(ms) { this.ms = ms; }
  static now() { return new Timestamp(Date.now()); }
  toMillis() { return this.ms; }
}

function encode(value) {
  if (value instanceof Timestamp) return { __ts: value.ms };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object" && !value.__op) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  }
  if (value && value.__op) return { ...value, values: (value.values || []).map(encode) };
  return value;
}
function decode(value) {
  if (value && typeof value === "object" && typeof value.__ts === "number") return new Timestamp(value.__ts);
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
  }
  return value;
}

export function arrayUnion(...values) { return { __op: ARRAY_UNION, values }; }
export function deleteField() { return { __op: DELETE_FIELD }; }

export function initializeApp() { return { name: "fake" }; }
export function initializeFirestore() { return { __db: true }; }
export function getFirestore() { return { __db: true }; }
export function persistentLocalCache() { return {}; }
export function persistentSingleTabManager() { return {}; }

function join(...parts) { return parts.filter(Boolean).join("/"); }
export function doc(dbOrColl, ...segments) {
  const base = dbOrColl && dbOrColl.__type === "coll" ? dbOrColl.path : "";
  return { __type: "doc", path: join(base, ...segments) };
}
export function collection(dbOrDoc, ...segments) {
  const base = dbOrDoc && dbOrDoc.__type === "doc" ? dbOrDoc.path : "";
  return { __type: "coll", path: join(base, ...segments) };
}

let mirror = new Map();
async function refresh() {
  mirror = new Map(JSON.parse(await window.__fsRead()));
  return mirror;
}

function snapFrom(map, path) {
  const raw = map.get(path);
  return {
    id: path.split("/").pop(),
    ref: { __type: "doc", path },
    exists: () => raw !== undefined,
    data: () => (raw === undefined ? undefined : decode(raw)),
  };
}

export async function getDoc(ref) { return snapFrom(await refresh(), ref.path); }

async function write(path, data, mode) {
  await window.__fsWrite(path, JSON.stringify(encode(data ?? {})), mode);
  await tick();
}

export async function setDoc(ref, data, options = {}) {
  await write(ref.path, data, options.merge ? "merge" : "set");
}
export async function updateDoc(ref, data) {
  const map = await refresh();
  if (!map.has(ref.path)) throw new Error(`No document to update: ${ref.path}`);
  await write(ref.path, data, "update");
}
export async function deleteDoc(ref) { await write(ref.path, null, "delete"); }

// Direct children only, so games/X/players never leaks into games/X/activity.
function docsIn(map, collPath) {
  const prefix = collPath + "/";
  const out = [];
  for (const path of map.keys()) {
    if (!path.startsWith(prefix)) continue;
    if (path.slice(prefix.length).includes("/")) continue;
    out.push(snapFrom(map, path));
  }
  return out;
}

export function query(coll, ...constraints) { return { __type: "query", path: coll.path, constraints }; }
export function orderBy(field, direction = "asc") { return { kind: "orderBy", field, direction }; }
export function limit(n) { return { kind: "limit", n }; }

function applyConstraints(docs, constraints = []) {
  let out = [...docs];
  for (const c of constraints) {
    if (c.kind === "orderBy") {
      out.sort((a, b) => {
        const av = a.data()[c.field];
        const bv = b.data()[c.field];
        const an = av && av.toMillis ? av.toMillis() : av ?? 0;
        const bn = bv && bv.toMillis ? bv.toMillis() : bv ?? 0;
        return c.direction === "desc" ? bn - an : an - bn;
      });
    } else if (c.kind === "limit") {
      out = out.slice(0, c.n);
    }
  }
  return out;
}

export async function getDocs(target) {
  const map = await refresh();
  const docs = applyConstraints(docsIn(map, target.path), target.constraints);
  return { docs, size: docs.length, empty: docs.length === 0 };
}

const listeners = [];
function sliceKey(map, entry) {
  if (entry.isCollection) {
    return JSON.stringify(docsIn(map, entry.path).map((d) => [d.id, map.get(entry.path + "/" + d.id)]));
  }
  return JSON.stringify(map.get(entry.path) ?? null);
}
function fire(map, entry) {
  if (entry.isCollection) {
    const docs = applyConstraints(docsIn(map, entry.path), entry.constraints);
    entry.cb({ docs, size: docs.length, empty: docs.length === 0 });
  } else {
    entry.cb(snapFrom(map, entry.path));
  }
}

async function tick() {
  const map = await refresh();
  for (const entry of [...listeners]) {
    const key = sliceKey(map, entry);
    if (key !== entry.lastKey) {
      entry.lastKey = key;
      fire(map, entry);
    }
  }
}
// Picks up writes made by the other "devices" in the test.
setInterval(() => { tick().catch(() => {}); }, 80);

export function onSnapshot(target, cb) {
  const entry = { path: target.path, isCollection: target.__type !== "doc", constraints: target.constraints, cb, lastKey: null };
  listeners.push(entry);
  refresh().then((map) => { entry.lastKey = sliceKey(map, entry); fire(map, entry); });
  return () => {
    const i = listeners.indexOf(entry);
    if (i !== -1) listeners.splice(i, 1);
  };
}

export async function runTransaction(db, fn) {
  return fn({
    get: async (ref) => snapFrom(await refresh(), ref.path),
    set: async (ref, data) => write(ref.path, data, "set"),
    update: async (ref, data) => write(ref.path, data, "update"),
    delete: async (ref) => write(ref.path, null, "delete"),
  });
}
