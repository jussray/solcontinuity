import { cp, mkdir } from "node:fs/promises";

await mkdir("dist/dashboard", { recursive: true });
await cp("src/dashboard", "dist/dashboard", { recursive: true, force: true });
