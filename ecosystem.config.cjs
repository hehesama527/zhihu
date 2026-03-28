const path = require("node:path");

const rootDir = __dirname;
const logDir = path.join(rootDir, ".runlogs");

function createApp(name, args) {
  return {
    name,
    cwd: rootDir,
    script: "npm",
    args,
    interpreter: "none",
    exec_mode: "fork",
    autorestart: true,
    restart_delay: 3000,
    kill_timeout: 10000,
    env: {
      NODE_ENV: "production"
    },
    out_file: path.join(logDir, `${name}.out.log`),
    error_file: path.join(logDir, `${name}.err.log`),
    merge_logs: true,
    time: true
  };
}

module.exports = {
  apps: [
    createApp("zhihu-api", "run start -w @zhihu-mvp/api"),
    createApp("zhihu-worker", "run start -w @zhihu-mvp/worker"),
    createApp("zhihu-web", "run start -w @zhihu-mvp/web -- --port 3000")
  ]
};
