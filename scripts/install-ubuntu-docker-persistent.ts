#!/usr/bin/env bun
// @ts-nocheck

// Persistent Ubuntu container on Apple silicon macOS using Bun
// Mirrors install-ubuntu-docker-persistent.sh

import { $ } from "bun";

const DRY_RUN = process.env.DRY_RUN === "1";

function msg(text: string) {
  console.log(`\n\x1b[1;34m[+]\x1b[0m ${text}`);
}
function err(text: string): never {
  throw new Error(text);
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

async function which(cmd: string): Promise<string | null> {
  const p = await $`command -v ${cmd}`.quiet().nothrow();
  if (p.exitCode !== 0) return null;
  const out = await p.text();
  return out.trim();
}

async function getExternalVolumes(): Promise<string[]> {
  const out = await $`df -h`.quiet().text();
  const lines = out.split(/\r?\n/).slice(1);
  const mounts = lines
    .map((line: string) => line.trim().split(/\s+/))
    .filter((cols: string[]) => cols.length >= 1)
    .map((cols: string[]) => cols[cols.length - 1])
    .filter((m: string) => m && m.startsWith("/Volumes/"));
  return [...new Set<string>(mounts)];
}

async function getDockerBin(prefer?: string): Promise<string> {
  // Just check if the binary exists, don't test if it works yet
  // (docker version hangs if daemon isn't running)
  
  if (prefer) {
    const preferFile = Bun.file(prefer);
    if (await preferFile.exists()) return prefer;
    err(`Provided --docker-bin not found at: ${prefer}`);
  }

  if (await commandExists("docker")) {
    return "docker";
  }

  const candidates = [
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker",
  ];
  for (const c of candidates) {
    const candidateFile = Bun.file(c);
    if (await candidateFile.exists()) return c;
  }
  err(
    "Docker CLI not found. Ensure Docker Desktop (or another Docker engine) is installed."
  );
}

async function requireRunningDocker(dockerBin: string) {
  msg("🔍 Checking if Docker daemon is running...");
  let info;
  try {
    info = await Promise.race([
      $`${dockerBin} ps`.quiet().nothrow(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
    ]);
  } catch {
    info = { exitCode: 1 }; // Treat timeout as failure
  }
  if (info.exitCode !== 0) {
    msg("🚀 Docker is not running. Starting Docker Desktop...");
    if (DRY_RUN) {
      msg("   (DRY_RUN: would open Docker Desktop here)");
      return;
    }
    
    // Check if Docker.app exists
    const dockerAppPath = "/Applications/Docker.app";
    const dockerApp = Bun.file(dockerAppPath);
    if (!(await dockerApp.exists())) {
      err(
        "Docker Desktop not found at /Applications/Docker.app. Please install Docker Desktop and re-run this script."
      );
    }
    
    // Open Docker Desktop
    const openResult = await $`open -a Docker`.nothrow();
    if (openResult.exitCode !== 0) {
      err("Failed to open Docker Desktop. Please start it manually and re-run this script.");
    }
    
    // Wait for Docker daemon to be ready
    msg("⏳ Waiting for Docker daemon to start... (this may take 30-60 seconds)");
    let attempts = 0;
    const maxAttempts = 90; // 90 seconds timeout for slower systems
    for (;;) {
      attempts++;
      await new Promise((r) => setTimeout(r, 1000));
      
      const checkInfo = await Promise.race([
        $`${dockerBin} ps`.quiet().nothrow(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000))
      ]).catch(() => ({ exitCode: 1 }));
      if (checkInfo.exitCode === 0) {
        msg(`   Docker started successfully after ${attempts} seconds`);
        break;
      }
      
      if (attempts >= maxAttempts) {
        err(
          "Docker Desktop didn't start within 90 seconds. Please:\n" +
          "   1. Check if Docker Desktop opened in your Applications\n" +
          "   2. Look for any error messages in Docker Desktop\n" +
          "   3. Once Docker shows 'Docker is running', re-run this script"
        );
      }
      
      if (attempts % 15 === 0) {
        msg(`   Still waiting... (${attempts}s elapsed)`);
      }
    }
  }
  msg("✅ Docker is running.");
}

async function containerExists(name: string): Promise<boolean> {
  const p = await $`docker ps -a --format {{.Names}}`.quiet().nothrow();
  if (p.exitCode !== 0) return false;
  const list = (await p.text()).split(/\r?\n/).map((s: string) => s.trim());
  return list.includes(name);
}

async function main() {
  // Args: --path <dir> or -p <dir>
  const argv = process.argv.slice(2);
  let basePath: string | undefined;
  let dockerBinArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--path" || a === "-p") {
      basePath = argv[i + 1];
      i++;
    } else if (a.startsWith("--path=")) {
      basePath = a.split("=", 2)[1];
    } else if (a === "--docker-bin" || a === "-d") {
      dockerBinArg = argv[i + 1];
      i++;
    } else if (a.startsWith("--docker-bin=")) {
      dockerBinArg = a.split("=", 2)[1];
    }
  }
  if (DRY_RUN) {
    msg("DRY_RUN enabled: listing external volumes and exiting before any changes.");
    if (basePath) {
      console.log(`  - Using base path: ${basePath}`);
    } else {
      const vols = await getExternalVolumes();
      if (vols.length === 0) {
        console.log("  (no external volumes under /Volumes found)");
      } else {
        vols.forEach((v) => console.log(`  - ${v}`));
      }
    }
    process.exit(0);
  }

  let UBUNTU_ROOT: string;
  
  // Check for DATA_PATH environment variable first
  if (process.env.DATA_PATH) {
    UBUNTU_ROOT = process.env.DATA_PATH;
    msg(`Using DATA_PATH environment variable: ${UBUNTU_ROOT}`);
  } else if (basePath) {
    UBUNTU_ROOT = `${basePath}/ubuntu-data`;
    msg(`Using base path for persistence: ${basePath}`);
  } else {
    msg("🔎 Detecting external volumes under /Volumes ...");
    const vols = await getExternalVolumes();
    if (vols.length === 0) {
      msg("No external volumes found. Using home directory for persistence.");
      UBUNTU_ROOT = `${Bun.env.HOME}/ubuntu`;
      msg(`Using home directory: ${UBUNTU_ROOT}`);
    } else {
      msg("Found the following external mounts:");
      vols.forEach((v, i) => console.log(`${String(i + 1).padStart(2, " ")}) ${v}`));
      console.log(`${String(vols.length + 1).padStart(2, " ")}) Use home directory (${Bun.env.HOME}/ubuntu)`);

      const answer = prompt("Enter the number of the volume you want to use for persistence: ");
      const idx = Number.parseInt(answer || "", 10);
      if (!Number.isInteger(idx) || idx < 1 || idx > vols.length + 1) {
        err("Invalid selection.");
      }
      
      if (idx === vols.length + 1) {
        // User selected home directory option
        UBUNTU_ROOT = `${Bun.env.HOME}/ubuntu`;
        msg(`Selected home directory: ${UBUNTU_ROOT}`);
      } else {
        // User selected an external drive
        const EXT_DRIVE = vols[idx - 1];
        msg(`Selected drive: ${EXT_DRIVE}`);
        UBUNTU_ROOT = `${EXT_DRIVE}/ubuntu-data`;
      }
    }
  }

  msg("🔍 Looking for Docker CLI...");
  const dockerBin = await getDockerBin(dockerBinArg);
  msg(`   Found: ${dockerBin}`);
  await requireRunningDocker(dockerBin);

  msg("⬇️ Pulling Ubuntu (ubuntu:latest) image ...");
  await $`${dockerBin} pull ubuntu:latest`;

  msg("📁 Creating persistent folder on the external drive ...");
  const ubuntuDir = Bun.file(UBUNTU_ROOT);
  if (!(await ubuntuDir.exists())) {
    await $`mkdir -p ${UBUNTU_ROOT}`;
  }
  msg(`✅ Persistent path: ${UBUNTU_ROOT}`);  const name = "ubuntu";
  async function containerExistsWith(bin: string, container: string): Promise<boolean> {
    const p = await $`${bin} ps -a --format {{.Names}}`.quiet().nothrow();
    if (p.exitCode !== 0) return false;
    const list = (await p.text()).split(/\r?\n/).map((s: string) => s.trim());
    return list.includes(container);
  }
  if (await containerExistsWith(dockerBin, name)) {
    msg("♻️ Reusing existing container 'ubuntu' ...");
    await $`${dockerBin} start -ai ${name}`;
  } else {
    msg("🚢 Creating a persistent Ubuntu container with bind-mount ...");
    msg("📦 Installing Python, Bun, Node.js, and V language on first boot...");
    
    // Create initial setup script
    const setupScript = `#!/bin/bash
set -e
echo "🐍 Installing Python 3.14..."
apt-get update
apt-get install -y software-properties-common curl wget unzip git build-essential
add-apt-repository -y ppa:deadsnakes/ppa
apt-get update
apt-get install -y python3.14 python3.14-venv python3.14-dev python3-pip

echo "🟢 Installing Node.js (latest LTS via NodeSource)..."
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt-get install -y nodejs

echo "🥟 Installing Bun..."
if [ ! -d "$HOME/.bun" ]; then
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
  echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
else
  echo "Bun already installed, skipping..."
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

echo "⚡ Installing V language..."
if [ ! -d "/opt/vlang" ]; then
  git clone https://github.com/vlang/v /opt/vlang
  cd /opt/vlang
  make
  ln -sf /opt/vlang/v /usr/local/bin/v
  echo 'export PATH="/opt/vlang:$PATH"' >> ~/.bashrc
else
  echo "V language already installed, skipping..."
  cd /opt/vlang
  git pull origin master || true
  make
fi

echo "✅ All languages installed!"
echo "Python: $(python3.14 --version)"
echo "Node.js: $(node --version)"
echo "Bun: $($HOME/.bun/bin/bun --version)"
echo "V: $(v version)"

# Set python3.14 as the default python3
update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.14 1
update-alternatives --set python3 /usr/bin/python3.14

# Mark setup as complete
touch /data/.setup-complete

echo ""
echo "🎉 Setup complete! Starting bash shell..."
echo ""

exec /bin/bash
`;
    
    const scriptPath = `${UBUNTU_ROOT}/.setup-env.sh`;
    await Bun.write(scriptPath, setupScript);
    await $`chmod +x ${scriptPath}`;
    
    // Run the container with setup script first time, then it will use bash
    await $`${dockerBin} run -it --name ${name} --hostname ${name} -v ${UBUNTU_ROOT}:/data --entrypoint /bin/bash ubuntu:latest -c "if [ ! -f /data/.setup-complete ]; then /data/.setup-env.sh; else exec /bin/bash; fi"`;
  }

  msg(`🛑 Container stopped. Anything you placed under /data is stored on ${UBUNTU_ROOT}.`);
  msg("💡 To restart the same persistent environment later, run:");
  console.log("   docker start -ai ubuntu");
  msg("🎉 You now have a fully-persistent Ubuntu on your Mac!");
  msg("📦 Installed: Python 3.14, Node.js (LTS), Bun, V language");
}

main().catch((e) => {
  console.error(`\n\x1b[1;31m[x]\x1b[0m ${e?.message ?? String(e)}`);
  process.exit(1);
});
