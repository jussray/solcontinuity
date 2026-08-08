import { accessSync, constants } from "node:fs";

try {
  accessSync("setup.sh", constants.X_OK);
} catch {
  console.error("setup.sh must be executable because README advertises ./setup.sh");
  process.exit(1);
}
