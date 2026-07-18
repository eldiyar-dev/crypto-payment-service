module.exports = {
  apps: [{
    name: 'back',
    script: './dist/main.js',
    exec_mode: 'cluster',
    // LOAD-BEARING: each instance runs its own monitors and its own in-memory deposit queue,
    // and there is no leader election or shared broker. Raising this duplicates every sweep.
    instances: 1,
    // Must exceed the time needed to drain an in-flight withdrawal (a TRON confirmation wait
    // alone can take ~40s). At 4000ms PM2 escalated to SIGKILL mid-withdrawal.
    kill_timeout: 60000,
    autorestart: true,
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
  }]
};
