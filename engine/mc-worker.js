// ── mc-worker.js ───────────────────────────────────────────────────────────
// The Node worker thread for montecarlo-parallel.js: worker-handler.js over
// worker_threads. (The page's twin is site/worker.js.)

import { parentPort } from "node:worker_threads";
import { makeHandler } from "./worker-handler.js";

const handle = makeHandler((m) => parentPort.postMessage(m));
parentPort.on("message", handle);
