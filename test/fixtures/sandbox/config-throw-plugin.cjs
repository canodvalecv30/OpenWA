// Sandbox fixture: a plain (non-async) onConfigChange that throws on a value it refuses, the shape of a
// plugin validating its new config.
module.exports = class ConfigThrowPlugin {
  onConfigChange(_ctx, config) {
    if (config.mode !== 'ok') throw new Error(`unsupported mode: ${config.mode}`);
  }

  healthCheck() {
    return { healthy: true, message: 'alive' };
  }
};
