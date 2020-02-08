/* pm2 configuration file. more info at https://pm2.io/ */

module.exports = {
  apps: [
    {
      script: 'index.js',
      // TODO: not working?
      watch: true,
      ignore_watch: ['node_modules', '.cache', 'assets', 'build', 'test'],
      exp_backoff_restart_delay: 100
    }
  ]
}
