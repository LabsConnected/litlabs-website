/** litt version — Show CLI version. */

import { c } from "../lib/utils.js";

export async function versionCommand(_args: string[]): Promise<number> {
  const version = "0.1.0";
  console.log(`${c.magenta}LiTT CLI${c.reset} ${c.green}v${version}${c.reset}`);
  console.log(`${c.dim}Node ${process.version} · ${process.platform} ${process.arch}${c.reset}`);
  return 0;
}
