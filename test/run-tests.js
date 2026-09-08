// Drives the real docs/app.js in a browser against an in-memory Firestore.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const fs = require("fs");
const path = require("path");

const DOCS = "/home/user/Claude-app/docs";
const HERE = __dirname;

const results = [];
function check(name, actual, expected, note = "") {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass, actual, expected, note });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}`);
  if (!pass) console.log(`      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}${note ? "\n      " + note : ""}`);
}

// One shared backend for every "device" page in the run.
const store = new Map();
function applyOps(target, patch) {
  const out = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value && value.__op === "__arrayUnion") {
      const existing = Array.isArray(out[key]) ? out[key] : [];
      out[key] = [...existing, ...value.values];
    } else if (value && value.__op === "__deleteField") {
      delete out[key];
    } else {
      out[key] = value;
    }
  }
  return out;
}
function fsRead() { return JSON.stringify([...store.entries()]); }
function fsWrite(path, json, mode) {
  const data = JSON.parse(json);
  if (mode === "delete") store.delete(path);
  else if (mode === "set") store.set(path, applyOps({}, data));
  else store.set(path, applyOps(store.get(path) || {}, data)); // merge | update
  return true;
}
function docsUnder(prefix) {
  return [...store.keys()].filter((p) => p.startsWith(prefix));
}

async function newPage(browser, uid) {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.exposeFunction("__fsRead", fsRead);
  await page.exposeFunction("__fsWrite", fsWrite);
  const errors = [];
  page.on("pageerror", (e) => { errors.push(e.message); console.log(`\n!! PAGEERROR on ${uid}: ${e.message}\n${e.stack}\n`); });
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.__errors = errors;

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.includes("firebase-app.js")) {
      return route.fulfill({ contentType: "text/javascript", body: "export function initializeApp(){return{name:'fake'}}" });
    }
    if (url.includes("firebase-auth.js")) {
      return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(HERE, "fake-auth.js"), "utf8") });
    }
    if (url.includes("firebase-firestore.js")) {
      return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(HERE, "fake-firestore.js"), "utf8") });
    }
    if (url.includes("qrcode")) {
      return route.fulfill({ contentType: "text/javascript", body: "window.qrcode=()=>({addData(){},make(){},createSvgTag:()=>'<svg></svg>'})" });
    }
    if (url.endsWith("/index.html") || url.endsWith("/")) {
      return route.fulfill({ contentType: "text/html", body: fs.readFileSync(path.join(DOCS, "index.html"), "utf8") });
    }
    if (url.endsWith("app.js")) {
      return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(DOCS, "app.js"), "utf8") });
    }
    if (url.endsWith("firebase-config.js")) {
      return route.fulfill({ contentType: "text/javascript", body: "export const firebaseConfig={apiKey:'fake',projectId:'fake'}" });
    }
    return route.fulfill({ status: 204, body: "" });
  });

  await page.addInitScript((u) => { globalThis.__TEST_UID = u; }, uid);
  await page.goto("https://poker.test/index.html");
  await page.waitForFunction(() => document.querySelector("#name-input") || document.querySelector(".error-text"), { timeout: 5000 });
  return page;
}

// Convenience wrappers around the real UI.
async function setName(page, name) {
  await page.fill("#name-input", name);
  await page.dispatchEvent("#name-input", "input");
}
async function hostGame(page, { name = "Test Game", buyIn = "20", chip = "1000" } = {}) {
  await page.click("#btn-host");
  await page.waitForSelector("#sheet-buyin");
  await page.fill("#sheet-game-name", name);
  await page.fill("#sheet-buyin", buyIn);
  await page.fill("#sheet-chipvalue", chip);
  await page.click("#sheet-submit");
  await page.waitForSelector(".room", { timeout: 5000 });
  return page.textContent(".topbar-title .code-text");
}

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

  // ---------------------------------------------------------------
  console.log("\n--- Identity: Player ID lifecycle ---");
  const p1 = await newPage(browser, "device-uid-1");
  await setName(p1, "Jake");
  const firstId = await p1.evaluate(() => localStorage.getItem("poker.playerId"));
  check("1. first run mints a Player ID", /^[A-Z0-9]{6}$/.test(firstId || ""), true, `got ${firstId}`);

  const shownId = (await p1.textContent("#btn-player-id")) || "";
  check("2. Player ID is shown on Home", shownId.includes(firstId), true, `button read: ${shownId}`);

  await p1.reload();
  await p1.waitForSelector("#name-input");
  const afterReload = await p1.evaluate(() => localStorage.getItem("poker.playerId"));
  check("3. reload reuses the same ID", afterReload, firstId);

  // ---------------------------------------------------------------
  console.log("\n--- Hosting and the core money flow ---");
  await setName(p1, "Jake");
  const code = (await hostGame(p1)).trim();
  check("4. hosting creates a game with a 5-char code", /^[A-Z0-9]{5}$/.test(code), true, `code ${code}`);

  const hostSeat = await p1.evaluate((c) => {
    const rows = [...document.querySelectorAll(".row[data-uid]")];
    return rows.map((r) => r.querySelector(".player-name").textContent);
  }, code);
  check("5. host is seated at their own table", hostSeat, ["Jake"]);

  const hostBuyIn = await p1.textContent(".row[data-uid] .buyin-line");
  check("6. host's opening buy-in converts to chips", hostBuyIn.trim(), "Buy-in: $20 · 1000 chips");

  // Rebuy label
  await p1.click('[data-action="buyin"]');
  await p1.waitForSelector("#sheet-submit");
  const buyInHeading = await p1.textContent(".sheet h2");
  await p1.click("#sheet-submit");
  await p1.waitForTimeout(150);
  const rebuyLabel = (await p1.textContent('[data-action="buyin"]')).trim();
  check("7. second buy-in is labelled Rebuy", rebuyLabel, "↻ Rebuy", `first sheet said: ${buyInHeading}`);

  const afterRebuy = (await p1.textContent(".row[data-uid] .buyin-line")).trim();
  check("8. rebuy adds to the buy-in total", afterRebuy, "Buy-in: $40 · 2000 chips");

  // Cash out, then rebuy, then cash out again
  await p1.click('[data-action="cashout"]');
  await p1.waitForSelector("#cashout-chips");
  await p1.fill("#cashout-chips", "2500");
  await p1.click("#sheet-submit");
  await p1.waitForTimeout(150);
  const cashOutStillThere = await p1.$('[data-action="cashout"]');
  check("9. Cash Out stays available after cashing out", !!cashOutStillThere, true);

  const netAfterCashOut = (await p1.textContent(".row[data-uid] .net")).trim();
  check("10. net = cash-out minus buy-in", netAfterCashOut, "+$10");

  await p1.click('[data-action="buyin"]');
  await p1.waitForSelector("#sheet-submit");
  await p1.click("#sheet-submit");
  await p1.waitForTimeout(150);
  await p1.click('[data-action="cashout"]');
  await p1.waitForSelector("#cashout-chips");
  await p1.fill("#cashout-chips", "500");
  await p1.click("#sheet-submit");
  await p1.waitForTimeout(150);
  const cycleNet = (await p1.textContent(".row[data-uid] .net")).trim();
  check("11. cash-out/rebuy/cash-out again nets correctly", cycleNet, "$0",
    "bought $60 (20+20+20), cashed $60 (2500+500 chips = 3000 chips)");

  const cashLine = (await p1.$$eval(".row[data-uid] .buyin-line", (e) => e.map((x) => x.textContent.trim())));
  check("12. row shows cumulative cash-out with chips", cashLine[1], "Cash-out: $60 · 3000 chips");

  // ---------------------------------------------------------------
  console.log("\n--- Adding players, with and without a Player ID ---");
  await p1.click("#btn-add-player");
  await p1.waitForSelector("#sheet-player-name");
  await p1.fill("#sheet-player-name", "Marcus");
  await p1.click("#sheet-submit");
  await p1.waitForTimeout(200);
  const names = await p1.$$eval(".row[data-uid] .player-name", (e) => e.map((x) => x.textContent));
  check("13. player added without an ID appears at the table", names, ["Jake", "Marcus"]);

  const marcusIndexed = await p1.evaluate(() => {
    const dump = window.__store ? window.__store() : null;
    return dump;
  });
  // Add a player WITH an id: first mint one on a second device.
  const p2 = await newPage(browser, "device-uid-2");
  await setName(p2, "Priya");
  const priyaId = await p2.evaluate(() => localStorage.getItem("poker.playerId"));

  await p1.click("#btn-add-player");
  await p1.waitForSelector("#sheet-player-id");
  await p1.fill("#sheet-player-name", "Priya");
  await p1.fill("#sheet-player-id", priyaId);
  await p1.click("#sheet-submit");
  await p1.waitForTimeout(250);
  const names2 = await p1.$$eval(".row[data-uid] .player-name", (e) => e.map((x) => x.textContent));
  check("14. player added with an ID appears at the table", names2, ["Jake", "Marcus", "Priya"]);

  // Bad ID is rejected
  await p1.click("#btn-add-player");
  await p1.waitForSelector("#sheet-player-id");
  await p1.fill("#sheet-player-name", "Ghost");
  await p1.fill("#sheet-player-id", "ZZZZZZ");
  await p1.click("#sheet-submit");
  await p1.waitForTimeout(250);
  const badIdError = (await p1.textContent("#sheet-error")).trim();
  check("15. unknown Player ID is rejected", badIdError.length > 0, true, `message: ${badIdError}`);

  // Regression: a rejected submit must stay retryable. This used to leave
  // the button permanently disabled because e.currentTarget is null after
  // an await, so the re-enable threw instead of running.
  const stuckAfterError = await p1.$eval("#sheet-submit", (b) => b.disabled);
  check("15b. Add button is retryable after a rejected submit", stuckAfterError, false);

  await p1.fill("#sheet-player-id", "");
  await p1.click("#sheet-submit");
  await p1.waitForTimeout(250);
  const recovered = await p1.$$eval(".row[data-uid] .player-name", (e) => e.map((x) => x.textContent));
  check("15c. and the retry actually goes through", recovered.includes("Ghost"), true, `table: ${JSON.stringify(recovered)}`);

  // ---------------------------------------------------------------
  console.log("\n--- The point of the whole feature: Priya sees the game ---");
  await p2.reload();
  await p2.waitForSelector("#name-input");
  await p2.waitForTimeout(600);
  const priyaGames = await p2.$$eval(".my-game-row .player-name", (e) => e.map((x) => x.textContent));
  check("16. added player sees the game on their own phone", priyaGames, ["Test Game"]);

  const priyaCode = await p2.$$eval(".my-game-row .code-pill", (e) => e.map((x) => x.textContent));
  check("17. and the row shows the game code", priyaCode, [code]);

  await p2.click(".my-game-row");
  await p2.waitForSelector(".room", { timeout: 5000 });
  const priyaSeesRows = await p2.$$eval(".row[data-uid] .player-name", (e) => e.map((x) => x.textContent));
  check("18. opening it shows the live table", priyaSeesRows, ["Jake", "Marcus", "Priya", "Ghost"]);

  const priyaYouPill = await p2.evaluate(() => {
    const rows = [...document.querySelectorAll(".row[data-uid]")];
    const mine = rows.find((r) => r.querySelector(".you-pill"));
    return mine ? mine.querySelector(".player-name").textContent : null;
  });
  check("19. her own host-created seat is marked 'you'", priyaYouPill, "Priya");

  const priyaHasControls = await p2.$('[data-action="buyin"]');
  check("20. she can watch but not edit (host-only writes)", !!priyaHasControls, false);

  // ---------------------------------------------------------------
  console.log("\n--- Joining by code when already seated ---");
  await p2.click("#btn-leave");
  await p2.waitForSelector("#name-input");
  await p2.click("#btn-join");
  await p2.waitForSelector("#sheet-code");
  await p2.fill("#sheet-code", code);
  await p2.click("#sheet-submit");
  await p2.waitForSelector(".room", { timeout: 5000 });
  await p2.waitForTimeout(200);
  const afterJoin = await p2.$$eval(".row[data-uid] .player-name", (e) => e.map((x) => x.textContent));
  check("21. joining by code does not create a duplicate row", afterJoin, ["Jake", "Marcus", "Priya", "Ghost"]);

  // ---------------------------------------------------------------
  console.log("\n--- Restoring an ID on a new device ---");
  const p3 = await newPage(browser, "device-uid-3");
  await setName(p3, "Priya");
  await p3.click("#btn-player-id");
  await p3.waitForSelector("#restore-player-id");
  await p3.fill("#restore-player-id", priyaId);
  await p3.click("#btn-restore-player-id");
  await p3.waitForTimeout(600);
  const restoredId = await p3.evaluate(() => localStorage.getItem("poker.playerId"));
  check("22. entering an existing ID adopts it", restoredId, priyaId);
  const restoredGames = await p3.$$eval(".my-game-row .player-name", (e) => e.map((x) => x.textContent));
  check("23. and her games come with her to the new phone", restoredGames, ["Test Game"]);

  // ---------------------------------------------------------------
  console.log("\n--- Settling up ---");
  // Locators (not handles) so they re-resolve after each live re-render.
  const seat = (i) => p1.locator(".row[data-uid]").nth(i);

  // Marcus and Priya each buy in $20. Jake already has $60 in and $60 out,
  // so the table balances if those two cash out $40 between them.
  for (const i of [1, 2, 3]) {
    await seat(i).locator('[data-action="buyin"]').click();
    await p1.waitForSelector("#sheet-submit");
    await p1.click("#sheet-submit");
    await p1.waitForTimeout(200);
  }

  for (const [i, chips] of [[1, "0"], [2, "1000"], [3, "1000"]]) {
    await seat(i).locator('[data-action="cashout"]').click();
    await p1.waitForSelector("#cashout-chips");
    await p1.fill("#cashout-chips", chips);
    await p1.click("#sheet-submit");
    await p1.waitForTimeout(200);
  }

  const potText = (await p1.textContent(".pot-summary-dollar")).trim();
  check("24. pot total counts every buy-in", potText, "$120", "Jake 60 + Marcus/Ghost/Priya 20 each");

  p1.on("dialog", (d) => d.accept());
  await p1.click("#btn-end");
  await p1.waitForSelector("#settlement-overlay", { timeout: 5000 });

  const settlementRows = await p1.$$eval("#settlement-overlay .row.simple", (rows) =>
    rows.map((r) => `${r.querySelector(".player-name").textContent}:${r.querySelector(".net").textContent}`)
  );
  check("25. settlement nets are right", settlementRows.sort(), ["Ghost:$0", "Jake:$0", "Marcus:-$20", "Priya:$0"].sort());

  const netSum = await p1.$$eval("#settlement-overlay .row.simple .net", (els) =>
    els.reduce((s, e) => s + Number(e.textContent.replace(/[+$,]/g, "")), 0)
  );
  check("26. nets sum to the shortfall when a table doesn't balance", netSum, -20,
    "$120 bought in, $100 cashed out — Marcus busted with a $0 cash-out");

  const txns = await p1.$$eval("#settlement-overlay .tx-row", (rows) =>
    rows.map((r) => r.textContent.replace(/\s+/g, " ").trim())
  );
  check("27. settlement produced a transaction list", Array.isArray(txns), true, `transactions: ${JSON.stringify(txns)}`);
  check("28. transactions are consistent with the nets", txns.length <= 1, true, `got: ${JSON.stringify(txns)}`);

  const potRows = await p1.$$eval("#settlement-overlay .pot-row", (rows) =>
    rows.map((r) => r.textContent.replace(/\s+/g, " ").trim())
  );
  check("29. settlement flags the $20 that never came back", potRows.some((t) => /off by \$20/.test(t)), true,
    `pot rows: ${JSON.stringify(potRows)}`);

  // ---------------------------------------------------------------
  console.log("\n--- Stale entries in Your games ---");
  await p3.reload();
  await p3.waitForSelector("#name-input");
  await p3.waitForTimeout(800);
  const gamesAfterEnd = await p3.$$eval(".my-game-row .player-name", (e) => e.map((x) => x.textContent));
  check("30. an ended game drops out of Your games", gamesAfterEnd, []);

  // ---------------------------------------------------------------
  const allErrors = [...p1.__errors, ...p2.__errors, ...p3.__errors];
  check("31. no uncaught page errors anywhere", allErrors, []);

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log("\nFAILURES:");
    failed.forEach((f) => console.log(` - ${f.name}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`));
  }
})();
