#!/usr/bin/env bun
// @ts-nocheck

import { $ } from "bun";

const CONTAINER_NAME = process.env.CONTAINER_NAME || "ubuntu";
const DRY_RUN = process.env.DRY_RUN === "1";

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

async function main() {
  msg(`🛑 Stopping Ubuntu container: ${CONTAINER_NAME}`);

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

  // Check if container is running
  if (!(await containerRunning(CONTAINER_NAME))) {
    warn(`Container '${CONTAINER_NAME}' is not running.`);
    return;
  }

  // Stop the container
  msg(`Stopping container '${CONTAINER_NAME}'...`);
  
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would run: docker stop ${CONTAINER_NAME}`);
    return;
  }

  try {
    await $`docker stop ${CONTAINER_NAME}`;
    success(`Container '${CONTAINER_NAME}' stopped successfully!`);
    msg("💡 To start it again, run: bun run start");
  } catch (e) {
    err(`Failed to stop container '${CONTAINER_NAME}': ${e}`);
  }
}

main().catch((e) => {
  err(e?.message ?? String(e));
});