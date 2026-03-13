import { rmSync } from "node:fs";

const packageNames = ["contracts", "server", "client"];

for (const packageName of packageNames) {
  rmSync(new URL(`../packages/${packageName}/dist`, import.meta.url), {
    force: true,
    recursive: true
  });
}
