#!/usr/bin/env bun
// @ts-nocheck

import { $ } from "bun";

const CONTAINER_NAME = process.env.CONTAINER_NAME || "ubuntu";
const DRY_RUN = process.env.DRY_RUN === "1";
const FORCE = process.env.FORCE === "1";

function msg(text: string) {
  console.log(`\n\x1b[1;34m[+]\x1b[0m ${text}`);
}

function success(text: string) {
  console.log(`\n\x1b[1;32m[✓]\x1b[0m ${text}`);
}

function warn(text: string) {
  console.log(`\n\x1b[1;33m[!]\x1b[0m ${text}`);
}

function err(text: string): never {
  console.error(`\n\x1b[1;31m[x]\x1b[0m ${text}`);
  process.exit(1);
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const p = await Promise.race([
      $`command -v ${cmd}`.quiet().nothrow(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000))
    ]);
    return p.exitCode === 0;
  } catch {
    return false;
  }
}

async function containerExists(name: string): Promise<boolean> {
  try {
    const p = await $`docker ps -a --format "{{.Names}}" | grep -x ${name}`.quiet().nothrow();
    return p.exitCode === 0;
  } catch {
    return false;
  }
}

async function containerRunning(name: string): Promise<boolean> {
  try {
    const p = await $`docker ps --format "{{.Names}}" | grep -x ${name}`.quiet().nothrow();
    return p.exitCode === 0;
  } catch {
    return false;
  }
}

async function askYesNo(question: string): Promise<boolean> {
  if (FORCE) return true;
  
  const answer = prompt(`${question} (y/N): `);
  return answer?.toLowerCase().startsWith('y') || false;
}

async function main() {
  msg(`🗑️  Deleting Ubuntu container: ${CONTAINER_NAME}`);

  // Check if Docker is available
  if (!(await commandExists("docker"))) {
    err("Docker is not installed or not in PATH. Please install Docker Desktop.");
  }

  // Check if Docker daemon is running
  try {
    await $`docker info`.quiet();
  } catch {
    err("Docker daemon is not running. Please start Docker Desktop.");
  }

  // Check if container exists
  if (!(await containerExists(CONTAINER_NAME))) {
    warn(`Container '${CONTAINER_NAME}' does not exist.`);
    return;
  }

  // Warning about data loss
  warn("⚠️  This will permanently delete the container!");
  
  const UBUNTU_ROOT = `${Bun.env.HOME}/${CONTAINER_NAME}`;
  try {
    const stats = await Bun.file(UBUNTU_ROOT).stat();
    if (stats && stats.isDirectory()) {
      warn(`📁 Data directory exists at: ${UBUNTU_ROOT}`);
    }
  } catch {
    // Directory doesn't exist, which is fine
  }

  // Confirm deletion
  if (!await askYesNo(`Are you sure you want to delete container '${CONTAINER_NAME}'?`)) {
    msg("Operation cancelled.");
    return;
  }

  // Stop container if running
  if (await containerRunning(CONTAINER_NAME)) {
    msg("Stopping running container...");
    if (!DRY_RUN) {
      try {
        await $`docker stop ${CONTAINER_NAME}`;
      } catch (e) {
        warn(`Failed to stop container: ${e}`);
      }
    } else {
      console.log(`[DRY RUN] Would run: docker stop ${CONTAINER_NAME}`);
    }
  }

  // Remove container
  msg(`Removing container '${CONTAINER_NAME}'...`);
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would run: docker rm ${CONTAINER_NAME}`);
  } else {
    try {
      await $`docker rm ${CONTAINER_NAME}`;
      success(`Container '${CONTAINER_NAME}' deleted successfully!`);
    } catch (e) {
      err(`Failed to delete container '${CONTAINER_NAME}': ${e}`);
    }
  }

  // Ask about data directory
  try {
    const stats = await Bun.file(UBUNTU_ROOT).stat();
    if (stats && stats.isDirectory()) {
      msg(`\n📁 Data directory still exists at: ${UBUNTU_ROOT}`);
      
      if (await askYesNo("Do you want to delete the data directory as well?")) {
        if (DRY_RUN) {
          console.log(`[DRY RUN] Would delete directory: ${UBUNTU_ROOT}`);
        } else {
          try {
            await $`rm -rf ${UBUNTU_ROOT}`;
            success(`Data directory deleted: ${UBUNTU_ROOT}`);
          } catch (e) {
            warn(`Failed to delete data directory: ${e}`);
            msg("You can manually delete it with:");
            console.log(`   rm -rf "${UBUNTU_ROOT}"`);
          }
        }
      } else {
        msg("Data directory preserved. You can use it when creating a new container.");
      }
    }
  } catch {
    // Directory doesn't exist, nothing to clean up
  }

  msg("💡 To create a new container, run: bun run setup");
}

main().catch((e) => {
  err(e?.message ?? String(e));
});