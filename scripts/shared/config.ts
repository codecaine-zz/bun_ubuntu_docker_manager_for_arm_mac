#!/usr/bin/env bun
// @ts-nocheck

import { Logger, ManagerError, loadConfigSync, saveConfig, type ManagerConfig } from "./utils.ts";
import { join } from "path";

export class ConfigManager {
  private config: ManagerConfig;
  private configPath: string;

  constructor() {
    this.configPath = join(process.env.HOME || "/tmp", ".ubuntu-manager.json");
    this.config = loadConfigSync();
  }

  get current(): ManagerConfig {
    return { ...this.config };
  }

  async update(updates: Partial<ManagerConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };
    await saveConfig(this.config);
  }

  async reset(): Promise<void> {
    try {
      if (await Bun.file(this.configPath).exists()) {
        await Bun.write(this.configPath + ".backup", JSON.stringify(this.config, null, 2));
        Logger.info(`Backup created at ${this.configPath}.backup`);
      }
      
      this.config = this.getDefaultConfig();
      await saveConfig(this.config);
      Logger.success("Configuration reset to defaults");
    } catch (error) {
      throw new ManagerError("Failed to reset configuration", { error });
    }
  }

  private getDefaultConfig(): ManagerConfig {
    return {
      containerName: "ubuntu",
      dataPath: join(process.env.HOME || "/tmp", "ubuntu"),
      autoStart: false,
      defaultVolumes: [],
      preferences: {
        showTimestamps: true,
        verboseLogging: false,
        autoCleanup: false
      }
    };
  }

  async showConfig(): Promise<void> {
    Logger.info("Current Configuration:");
    console.log(JSON.stringify(this.config, null, 2));
    console.log(`\nConfig file location: ${this.configPath}`);
    console.log(`Config file exists: ${await Bun.file(this.configPath).exists() ? "Yes" : "No"}`);
  }

  async setContainerName(name: string): Promise<void> {
    await this.update({ containerName: name });
    Logger.success(`Container name set to: ${name}`);
  }

  async setDataPath(path: string): Promise<void> {
    if (!await Bun.file(path).exists()) {
      throw new ManagerError(`Path does not exist: ${path}`);
    }
    await this.update({ dataPath: path });
    Logger.success(`Data path set to: ${path}`);
  }

  async toggleAutoStart(): Promise<void> {
    const newValue = !this.config.autoStart;
    await this.update({ autoStart: newValue });
    Logger.success(`Auto-start ${newValue ? "enabled" : "disabled"}`);
  }

  async addDefaultVolume(volume: string): Promise<void> {
    if (!this.config.defaultVolumes.includes(volume)) {
      const updatedVolumes = [...this.config.defaultVolumes, volume];
      await this.update({ defaultVolumes: updatedVolumes });
      Logger.success(`Added default volume: ${volume}`);
    } else {
      Logger.warn(`Volume already exists: ${volume}`);
    }
  }

  async removeDefaultVolume(volume: string): Promise<void> {
    const updatedVolumes = this.config.defaultVolumes.filter(v => v !== volume);
    if (updatedVolumes.length !== this.config.defaultVolumes.length) {
      await this.update({ defaultVolumes: updatedVolumes });
      Logger.success(`Removed default volume: ${volume}`);
    } else {
      Logger.warn(`Volume not found: ${volume}`);
    }
  }
}

// CLI interface for config management
export async function handleConfigCommand(args: string[]): Promise<void> {
  const configManager = new ConfigManager();
  
  if (args.length === 0) {
    await configManager.showConfig();
    return;
  }

  const command = args[0];
  
  try {
    switch (command) {
      case "show":
        await configManager.showConfig();
        break;
        
      case "reset":
        await configManager.reset();
        break;
        
      case "set":
        if (args.length < 3) {
          throw new ManagerError("Usage: config set <key> <value>");
        }
        await handleConfigSet(configManager, args[1], args[2]);
        break;
        
      case "toggle":
        if (args.length < 2) {
          throw new ManagerError("Usage: config toggle <key>");
        }
        await handleConfigToggle(configManager, args[1]);
        break;
        
      case "volume":
        await handleVolumeCommand(configManager, args.slice(1));
        break;
        
      default:
        Logger.error(`Unknown config command: ${command}`);
        console.log("\nAvailable commands:");
        console.log("  show                    - Show current configuration");
        console.log("  reset                   - Reset to default configuration");
        console.log("  set <key> <value>       - Set configuration value");
        console.log("  toggle <key>            - Toggle boolean configuration");
        console.log("  volume add <path>       - Add default volume");
        console.log("  volume remove <path>    - Remove default volume");
        console.log("  volume list             - List default volumes");
        process.exit(1);
    }
  } catch (error) {
    if (error instanceof ManagerError) {
      Logger.error(error.message);
    } else {
      Logger.error(`Configuration error: ${error}`);
    }
    process.exit(1);
  }
}

async function handleConfigSet(configManager: ConfigManager, key: string, value: string): Promise<void> {
  switch (key) {
    case "containerName":
    case "container-name":
      await configManager.setContainerName(value);
      break;
      
    case "dataPath":
    case "data-path":
      await configManager.setDataPath(value);
      break;
      
    default:
      throw new ManagerError(`Unknown configuration key: ${key}`);
  }
}

async function handleConfigToggle(configManager: ConfigManager, key: string): Promise<void> {
  switch (key) {
    case "autoStart":
    case "auto-start":
      await configManager.toggleAutoStart();
      break;
      
    default:
      throw new ManagerError(`Cannot toggle configuration key: ${key}`);
  }
}

async function handleVolumeCommand(configManager: ConfigManager, args: string[]): Promise<void> {
  if (args.length === 0) {
    args = ["list"];
  }
  
  const command = args[0];
  
  switch (command) {
    case "add":
      if (args.length < 2) {
        throw new ManagerError("Usage: config volume add <path>");
      }
      await configManager.addDefaultVolume(args[1]);
      break;
      
    case "remove":
      if (args.length < 2) {
        throw new ManagerError("Usage: config volume remove <path>");
      }
      await configManager.removeDefaultVolume(args[1]);
      break;
      
    case "list":
      const config = configManager.current;
      if (config.defaultVolumes.length === 0) {
        Logger.info("No default volumes configured");
      } else {
        Logger.info("Default volumes:");
        config.defaultVolumes.forEach((volume, index) => {
          console.log(`  ${index + 1}. ${volume}`);
        });
      }
      break;
      
    default:
      throw new ManagerError(`Unknown volume command: ${command}`);
  }
}