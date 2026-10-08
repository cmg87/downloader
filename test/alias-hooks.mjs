// Registered via `node --import ./test/alias-hooks.mjs --test ...`.
// Installs the `@/` alias resolve hook for the test worker process.

import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);
