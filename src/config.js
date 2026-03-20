const fs = require("fs");
const path = require("path");

function printHelp() {
  process.stdout.write(
    [
      "Script Runner Kit",
      "",
      "Usage:",
      "  script-runner-kit --config <path-to-config>",
      "",
      "Options:",
      "  --config <path>   Required. Path to runner config file (.json/.js/.cjs)",
      "  --port <number>   Optional. Override port from config",
      "  -h, --help        Show help",
      "",
      "Example:",
      "  npx script-runner-kit --config ./script-runner.config.json",
      "",
    ].join("\n")
  );
}

function parseArgv(argv) {
  const args = [...argv];
  const parsed = {
    configPath: "",
    port: undefined,
    help: false,
  };

  while (args.length > 0) {
    const current = args.shift();

    if (!current) {
      continue;
    }

    if (current === "-h" || current === "--help") {
      parsed.help = true;
      continue;
    }

    if (current.startsWith("--config=")) {
      parsed.configPath = current.slice("--config=".length).trim();
      continue;
    }

    if (current === "--config") {
      const value = args.shift();
      if (!value) {
        throw new Error("Missing value for --config");
      }
      parsed.configPath = value.trim();
      continue;
    }

    if (current.startsWith("--port=")) {
      const value = current.slice("--port=".length).trim();
      const port = Number(value);
      if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`Invalid --port value: ${value}`);
      }
      parsed.port = port;
      continue;
    }

    if (current === "--port") {
      const value = args.shift();
      if (!value) {
        throw new Error("Missing value for --port");
      }
      const port = Number(value);
      if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`Invalid --port value: ${value}`);
      }
      parsed.port = port;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return parsed;
}

function loadJsonConfig(configPath) {
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw);
}

function loadJsConfig(configPath) {
  const loaded = require(configPath);
  if (loaded && typeof loaded === "object" && "default" in loaded) {
    return loaded.default;
  }
  return loaded;
}

function normalizeAuthTokens(value, fieldPath) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldPath} must be an array of strings`);
  }
  const tokens = value.map((item) => String(item).trim()).filter(Boolean);
  if (tokens.length === 0) {
    throw new Error(`${fieldPath} must contain at least one non-empty token`);
  }
  return tokens;
}

function normalizeScriptFromConfig(configDir, scriptName, scriptConfig) {
  if (!scriptConfig || typeof scriptConfig !== "object") {
    throw new Error(`scripts.${scriptName} must be an object`);
  }

  const resolvedRootDir = path.resolve(
    configDir,
    typeof scriptConfig.rootDir === "string" && scriptConfig.rootDir.trim()
      ? scriptConfig.rootDir
      : "."
  );
  const authTokens =
    scriptConfig.authTokens === undefined
      ? undefined
      : normalizeAuthTokens(scriptConfig.authTokens, `scripts.${scriptName}.authTokens`);

  if (typeof scriptConfig.scriptPath === "string" && scriptConfig.scriptPath.trim()) {
    return {
      rootDir: resolvedRootDir,
      scriptPath: path.resolve(configDir, scriptConfig.scriptPath),
      authTokens,
    };
  }

  if (typeof scriptConfig.command === "string" && scriptConfig.command.trim()) {
    const args =
      scriptConfig.args === undefined
        ? []
        : Array.isArray(scriptConfig.args)
          ? scriptConfig.args
          : null;
    if (!args || args.some((item) => typeof item !== "string")) {
      throw new Error(`scripts.${scriptName}.args must be an array of strings`);
    }
    return {
      rootDir: resolvedRootDir,
      command: scriptConfig.command,
      args,
      authTokens,
    };
  }

  throw new Error(
    `scripts.${scriptName} must provide either scriptPath or command`
  );
}

function loadPackageJsonScripts(cwd) {
  const packageJsonPath = path.join(cwd, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return {};
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (err) {
    throw new Error(`Failed to parse package.json at ${packageJsonPath}: ${err.message}`);
  }

  if (!pkg || typeof pkg !== "object") {
    return {};
  }

  const scripts = pkg.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    return {};
  }

  const discovered = {};
  for (const scriptName of Object.keys(scripts)) {
    discovered[scriptName] = {
      rootDir: cwd,
      command: "npm",
      args: ["run", scriptName],
    };
    discovered[`npm:${scriptName}`] = {
      rootDir: cwd,
      command: "npm",
      args: ["run", scriptName],
    };
  }

  return discovered;
}

function resolveScriptConfig(configPath, rawConfig, cwd) {
  if (!rawConfig || typeof rawConfig !== "object") {
    throw new Error("Config must be an object");
  }

  const configDir = path.dirname(configPath);
  const globalAuthTokens =
    rawConfig.authTokens === undefined
      ? undefined
      : normalizeAuthTokens(rawConfig.authTokens, "authTokens");
  const scripts = rawConfig.scripts || {};
  if (typeof scripts !== "object" || Array.isArray(scripts)) {
    throw new Error("Config field 'scripts' must be an object when provided");
  }

  const resolvedScripts = {};
  for (const [scriptName, scriptConfig] of Object.entries(scripts)) {
    resolvedScripts[scriptName] = normalizeScriptFromConfig(
      configDir,
      scriptName,
      scriptConfig
    );
  }

  const discoveredScripts = loadPackageJsonScripts(cwd);
  for (const [scriptName, scriptConfig] of Object.entries(discoveredScripts)) {
    if (!resolvedScripts[scriptName]) {
      resolvedScripts[scriptName] = scriptConfig;
    }
  }

  if (Object.keys(resolvedScripts).length === 0) {
    throw new Error(
      "No scripts available. Add config.scripts or run in a directory with package.json scripts"
    );
  }

  for (const [scriptName, scriptConfig] of Object.entries(resolvedScripts)) {
    if (!Array.isArray(scriptConfig.authTokens) || scriptConfig.authTokens.length === 0) {
      if (globalAuthTokens && globalAuthTokens.length > 0) {
        resolvedScripts[scriptName] = {
          ...scriptConfig,
          authTokens: globalAuthTokens,
        };
      } else {
        throw new Error(
          `Auth required for scripts.${scriptName}. Add scripts.${scriptName}.authTokens or top-level authTokens`
        );
      }
    }
  }

  const resolvedAuditDir = path.resolve(
    configDir,
    typeof rawConfig.auditDir === "string" && rawConfig.auditDir.trim()
      ? rawConfig.auditDir
      : ".script-audit-logs"
  );

  const configuredPort =
    rawConfig.port !== undefined && rawConfig.port !== null
      ? Number(rawConfig.port)
      : undefined;
  if (
    configuredPort !== undefined &&
    (!Number.isInteger(configuredPort) || configuredPort <= 0)
  ) {
    throw new Error("Config field 'port' must be a positive integer when provided");
  }

  return {
    scripts: resolvedScripts,
    auditDir: resolvedAuditDir,
    port: configuredPort,
  };
}

function loadRunnerConfig(configPathArg, cwd) {
  if (!configPathArg || typeof configPathArg !== "string") {
    throw new Error("--config is required");
  }
  const resolvedPath = path.resolve(cwd, configPathArg);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  let rawConfig;
  if (ext === ".json") {
    rawConfig = loadJsonConfig(resolvedPath);
  } else if (ext === ".js" || ext === ".cjs") {
    rawConfig = loadJsConfig(resolvedPath);
  } else {
    throw new Error("Unsupported config extension. Use .json, .js, or .cjs");
  }

  return resolveScriptConfig(resolvedPath, rawConfig, cwd);
}

module.exports = {
  parseArgv,
  printHelp,
  loadRunnerConfig,
};
