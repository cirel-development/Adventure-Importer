#!/usr/bin/env node
// Verify build output and copy to Foundry module path if configured.
// Only cleans built JS/CSS — never touches static files (module.json, lang/, templates/).

import { existsSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, "..");

const REQUIRED = [
  "module.js",
  "ai-adventure-importer.css",
  "module.json",
  "lang/en.json",
];

let ok = true;
for (const file of REQUIRED) {
  const full = resolve(root, file);
  if (!existsSync(full)) {
    console.error(`✗ Missing: ${file}`);
    ok = false;
  } else {
    const { size } = statSync(full);
    console.log(`✓ ${file} (${(size / 1024).toFixed(1)} KB)`);
  }
}

if (!ok) {
  process.exit(1);
}

// Optional: copy to Foundry module path
const FOUNDRY_MODULE_PATH = process.env.FOUNDRY_MODULE_PATH;
if (FOUNDRY_MODULE_PATH) {
  const { execSync } = await import("child_process");
  console.log(`\nDeploying to ${FOUNDRY_MODULE_PATH}…`);
  execSync(`rsync -av --exclude=node_modules ${root}/ ${FOUNDRY_MODULE_PATH}/`);
  console.log("Deploy complete.");
}
