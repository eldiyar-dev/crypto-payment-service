module.exports = {
  apps: [{
    name: 'back',
    script: './dist/main.js',
    exec_mode: 'cluster',
    instances: 1,
    kill_timeout: 4000,
    autorestart: true,
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
  }]
};
