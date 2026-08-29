import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

function isWslDrvFs(): boolean {
  if (process.platform !== "linux") return false;

  const isWsl = Boolean(
    process.env.WSL_INTEROP ||
    process.env.WSL_DISTRO_NAME ||
    existsSync("/proc/sys/fs/binfmt_misc/WSLInterop"),
  );

  const cwd = process.cwd().replace(/\\/g, "/");
  const isDrvFs = /^\/mnt\/[a-z](?:\/|$)/i.test(cwd);

  return isWsl && isDrvFs;
}

const wslDrvFs = isWslDrvFs();

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist"],

    // Windows-mounted drives are materially slower under WSL because
    // process/file operations cross the Linux ↔ Windows filesystem
    // boundary. Keep the normal Vitest budget everywhere else.
    testTimeout: wslDrvFs ? 20_000 : 5_000,
  },
});
