// The page's solve worker: engine/worker-handler.js over a Web Worker (the
// Node twin is engine/mc-worker.js).
import { makeHandler } from "../engine/worker-handler.js";

const handle = makeHandler((m) => postMessage(m));
onmessage = (e) => handle(e.data);
