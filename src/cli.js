const { loadRunnerConfig, parseArgv, printHelp } = require("./config");
const { startServer } = require("./server");

function runCli(argv) {
  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (err) {
    process.stderr.write(`Argument error: ${err.message}\n\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (parsed.help) {
    printHelp();
    return;
  }

  let config;
  try {
    config = loadRunnerConfig(parsed.configPath, process.cwd());
  } catch (err) {
    process.stderr.write(`Config error: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  const envPort =
    process.env.PORT && Number.isInteger(Number(process.env.PORT))
      ? Number(process.env.PORT)
      : undefined;

  const port = parsed.port || envPort || config.port || 8088;

  startServer({
    scripts: config.scripts,
    auditDir: config.auditDir,
    port,
  });
}

module.exports = {
  runCli,
};
