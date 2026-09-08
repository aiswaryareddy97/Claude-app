// Anonymous auth stand-in. The uid is settable so a test can simulate a
// second device (or the same person after a browser wipe).
let uid = globalThis.__TEST_UID || "device-uid-1";

export function getAuth() { return { uid }; }
export function onAuthStateChanged(auth, next) {
  Promise.resolve().then(() => next({ uid }));
  return () => {};
}
export function signInAnonymously() { return Promise.resolve({ user: { uid } }); }
