// The e2e helpers reuse a few server modules (decrypting MFA secrets, TOTP codes) in plain Node.
// Those modules start with `import "server-only"`, which throws outside Next's server build, so this
// marks it as already loaded with an empty module. Import this first.
import { createRequire } from "node:module";
const require = createRequire(__filename);
const id = require.resolve("server-only");
require.cache[id] = { id, filename: id, loaded: true, exports: {} } as unknown as NodeJS.Module;
