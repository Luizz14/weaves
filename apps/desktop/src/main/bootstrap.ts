import { enableCompileCache } from "node:module";
import { join } from "node:path";
import { app } from "electron";

// V8 compiles the whole main bundle from source on every launch; Node's
// on-disk compile cache lets later launches reuse that work.
try {
	enableCompileCache(join(app.getPath("userData"), "node-compile-cache"));
} catch {}

require(join(__dirname, "index.js"));
