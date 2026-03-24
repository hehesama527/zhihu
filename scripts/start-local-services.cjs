const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const runDir = path.join(root, ".run");

fs.mkdirSync(runDir, { recursive: true });

async function main() {
  const apiPort = await findAvailablePort(8788);
  const webPort = await findAvailablePort(3001);

  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;

  const apiPid = startService("api", ["run", "start", "-w", "@zhihu-mvp/api"], {
    API_PORT: String(apiPort),
    API_URL: apiUrl,
    WEB_URL: webUrl
  });

  const workerPid = startService("worker", ["run", "start", "-w", "@zhihu-mvp/worker"], {
    API_URL: apiUrl,
    WEB_URL: webUrl
  });

  const webPid = startService(
    "web",
    ["run", "start", "-w", "@zhihu-mvp/web", "--", "--hostname", "0.0.0.0", "-p", String(webPort)],
    {
      API_BASE_URL: apiUrl,
      NEXT_PUBLIC_API_BASE_URL: apiUrl
    }
  );

  const manifest = {
    startedAt: new Date().toISOString(),
    api: {
      pid: apiPid,
      port: apiPort,
      url: apiUrl,
      log: path.join(".run", "api.log"),
      errLog: path.join(".run", "api.err.log")
    },
    worker: {
      pid: workerPid,
      log: path.join(".run", "worker.log"),
      errLog: path.join(".run", "worker.err.log")
    },
    web: {
      pid: webPid,
      port: webPort,
      url: webUrl,
      log: path.join(".run", "web.log"),
      errLog: path.join(".run", "web.err.log")
    }
  };

  fs.writeFileSync(path.join(runDir, "services.json"), JSON.stringify(manifest, null, 2));

  console.log(JSON.stringify(manifest, null, 2));
}

function startService(name, args, extraEnv) {
  const outPath = path.join(runDir, `${name}.log`);
  const errPath = path.join(runDir, `${name}.err.log`);
  const out = fs.openSync(outPath, "a");
  const err = fs.openSync(errPath, "a");
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const finalArgs =
    process.platform === "win32"
      ? ["/c", `npm ${args.map(quoteArg).join(" ")}`]
      : args;

  const child = spawn(command, finalArgs, {
    cwd: root,
    env: {
      ...process.env,
      ...extraEnv
    },
    detached: true,
    stdio: ["ignore", out, err],
    windowsHide: true
  });

  child.unref();
  return child.pid;
}

function quoteArg(value) {
  if (/[\s"]/u.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.unref();
      server.on("error", (error) => {
        if (error && error.code === "EADDRINUSE") {
          tryPort(port + 1);
          return;
        }
        reject(error);
      });
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        const selectedPort = typeof address === "object" && address ? address.port : port;
        server.close(() => resolve(selectedPort));
      });
    };

    tryPort(startPort);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
