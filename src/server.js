const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");

function nowStamp() {
  return new Date().toISOString().replaceAll(":", "-");
}

function fileSafeName(name) {
  return name.replaceAll(/[^a-zA-Z0-9._-]/g, "-");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function sendSse(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function readTokenFromRequest(req, url) {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (token) {
      return token;
    }
  }

  const headerToken = req.headers["x-runner-token"];
  if (typeof headerToken === "string" && headerToken.trim()) {
    return headerToken.trim();
  }

  const queryToken = url.searchParams.get("token");
  if (typeof queryToken === "string" && queryToken.trim()) {
    return queryToken.trim();
  }

  return "";
}

function verifyJwtWithSecrets(token, secrets) {
  for (const secret of secrets) {
    try {
      const payload = jwt.verify(token, secret, {
        algorithms: ["HS256", "HS384", "HS512"],
      });
      return { ok: true, payload };
    } catch (err) {
      continue;
    }
  }

  return { ok: false };
}

function createAuditLogger(auditDir, scriptName, rootDir, target, remoteAddress) {
  fs.mkdirSync(auditDir, { recursive: true });
  const logFile = path.join(
    auditDir,
    `${nowStamp()}__${fileSafeName(scriptName)}.log`
  );
  const stream = fs.createWriteStream(logFile, { flags: "a" });
  const write = (record) => {
    stream.write(
      `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`
    );
  };

  write({
    event: "start",
    script: scriptName,
    rootDir,
    target,
    remoteAddress,
  });

  return {
    logFile,
    write,
    close: () => stream.end(),
  };
}

function resolveExecutionTarget(scriptName, scriptConfig) {
  const rootDir = path.resolve(scriptConfig.rootDir);
  if (!fs.existsSync(rootDir)) {
    return { error: `Script config invalid (rootDir missing): ${scriptName}` };
  }

  if (typeof scriptConfig.scriptPath === "string" && scriptConfig.scriptPath.trim()) {
    const scriptPath = path.resolve(scriptConfig.scriptPath);
    if (!fs.existsSync(scriptPath)) {
      return { error: `Script config invalid (scriptPath missing): ${scriptName}` };
    }
    return {
      rootDir,
      target: scriptPath,
      command: "bash",
      args: [scriptPath],
    };
  }

  if (typeof scriptConfig.command === "string" && scriptConfig.command.trim()) {
    return {
      rootDir,
      target: `${scriptConfig.command} ${(scriptConfig.args || []).join(" ")}`.trim(),
      command: scriptConfig.command,
      args: Array.isArray(scriptConfig.args) ? scriptConfig.args : [],
    };
  }

  return { error: `Script config invalid (no executable target): ${scriptName}` };
}

function renderHome(scripts) {
  const options = Object.entries(scripts)
    .map(([name, config]) => {
      const safeName = escapeHtml(name);
      const safeRoot = escapeHtml(config.rootDir);
      return `<option value="${safeName}">${safeName} (${safeRoot})</option>`;
    })
    .join("");

  return `<!doctype html>
<meta charset="utf-8">
<title>Script Runner</title>
<h1>Script Runner</h1>
<p>Use GET /api/&lt;script-name&gt; to trigger execution and stream output via SSE.</p>
<h2>Quick Usage</h2>
<ul>
  <li>Start: <code>npx script-runner-kit --config ./script-runner.config.json</code></li>
  <li>Trigger: <code>GET /api/&lt;script-name&gt;</code> (for example <code>/api/check</code>)</li>
  <li>Auto-loads scripts from local <code>package.json</code> (config entries take precedence on name conflicts)</li>
  <li>Auth: send JWT via <code>Authorization: Bearer &lt;token&gt;</code>, <code>x-runner-token</code>, or <code>?token=</code></li>
</ul>
<label>script:</label>
<select id="name">${options}</select>
<label>jwt token:</label>
<input id="token" type="password" placeholder="paste JWT token" style="min-width: 360px" />
<button id="run">Run</button>
<pre id="out"></pre>
<script>
const out = document.getElementById('out');
const name = document.getElementById('name');
const token = document.getElementById('token');
const run = document.getElementById('run');
let es;
function log(line) { out.textContent += line + '\\n'; }
run.onclick = () => {
  out.textContent = '';
  if (es) es.close();
  const script = encodeURIComponent(name.value);
  const t = token.value.trim();
  const suffix = t ? ('?token=' + encodeURIComponent(t)) : '';
  es = new EventSource('/api/' + script + suffix);
  es.addEventListener('start', (e) => {
    const m = JSON.parse(e.data);
    log('[start] ' + m.script);
  });
  es.addEventListener('log', (e) => {
    const m = JSON.parse(e.data);
    log('[' + m.stream + '] ' + m.text);
  });
  es.addEventListener('end', (e) => {
    const m = JSON.parse(e.data);
    log('[end] exit=' + m.code + ' signal=' + m.signal);
    es.close();
  });
  es.addEventListener('error', (e) => {
    if (e.data) {
      const m = JSON.parse(e.data);
      log('[error] ' + m.message);
    } else {
      log('[error] connection closed');
    }
    if (es) es.close();
  });
};
</script>`;
}

function createServer({ scripts, auditDir }) {
  const running = new Map();

  return http.createServer((req, res) => {
    if (!req.url) {
      send(res, 400, "Bad Request");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/") {
      send(res, 200, renderHome(scripts), "text/html; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/")) {
      const scriptName = decodeURIComponent(
        url.pathname.slice("/api/".length)
      ).trim();
      const scriptConfig = scripts[scriptName];

      if (!scriptName || !scriptConfig) {
        send(res, 404, "Unknown script");
        return;
      }

      const token = readTokenFromRequest(req, url);
      if (!token) {
        send(res, 401, "Unauthorized: missing JWT token");
        return;
      }

      const authResult = verifyJwtWithSecrets(token, scriptConfig.authTokens || []);
      if (!authResult.ok) {
        send(res, 403, "Forbidden: invalid token");
        return;
      }

      const targetSpec = resolveExecutionTarget(scriptName, scriptConfig);
      if (targetSpec.error) {
        send(res, 500, targetSpec.error);
        return;
      }

      const { rootDir, target, command, args } = targetSpec;

      if (running.get(scriptName)) {
        send(res, 409, `Script is already running: ${scriptName}`);
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate, no-transform",
        Connection: "keep-alive",
        Pragma: "no-cache",
        Expires: "0",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      res.write(": connected\n\n");

      const audit = createAuditLogger(
        auditDir,
        scriptName,
        rootDir,
        target,
        req.socket.remoteAddress || "unknown"
      );

      const child = spawn(command, args, {
        cwd: rootDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
      child.stdin.end();
      running.set(scriptName, child);

      sendSse(res, "start", {
        script: scriptName,
        rootDir,
        target,
        subject:
          authResult.payload && typeof authResult.payload === "object"
            ? authResult.payload.sub || ""
            : "",
        logFile: audit.logFile,
      });

      child.stdout.on("data", (chunk) => {
        const text = String(chunk);
        sendSse(res, "log", { stream: "stdout", text });
        audit.write({ event: "log", stream: "stdout", text });
      });

      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        sendSse(res, "log", { stream: "stderr", text });
        audit.write({ event: "log", stream: "stderr", text });
      });

      child.on("error", (err) => {
        sendSse(res, "error", { message: err.message });
        audit.write({ event: "error", message: err.message });
      });

      child.on("close", (code, signal) => {
        running.delete(scriptName);
        sendSse(res, "end", { code, signal });
        audit.write({ event: "end", code, signal });
        audit.close();
        res.end();
      });

      req.on("close", () => {
        if (running.get(scriptName) === child) {
          audit.write({ event: "client-disconnect" });
          child.kill("SIGTERM");
        }
      });
      return;
    }

    send(res, 404, "Not Found");
  });
}

function startServer({ scripts, auditDir, port }) {
  const server = createServer({ scripts, auditDir });
  server.listen(port, () => {
    process.stdout.write(`Server listening on http://0.0.0.0:${port}\n`);
  });
  return server;
}

module.exports = {
  createServer,
  startServer,
};
