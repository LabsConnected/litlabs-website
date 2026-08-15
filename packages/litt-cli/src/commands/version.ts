/** litt version — Show CLI version. */

import { c } from "../lib/utils.js";
import { CLI_VERSION, CLI_PACKAGE_NAME } from "../lib/version.js";

export async function versionCommand(_args: string[]): Promise<number> {
  console.log(`${c.magenta}LiTT CLI${c.reset} ${c.green}v${CLI_VERSION}${c.reset}`);
  console.log(`${c.dim}Node ${process.version} · ${process.platform} ${process.arch}${c.reset}`);
  console.log(`${c.dim}Package: ${CLI_PACKAGE_NAME}${c.reset}`);
  console.log(`${c.dim}Upgrade: npm install -g ${CLI_PACKAGE_NAME}@latest${c.reset}`);
  return 0;
}
