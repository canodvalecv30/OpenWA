// Sandbox fixture: logs from a timer with a meta the structured clone cannot copy (a function), the
// shape of a plugin passing a fetch Response as meta. onEnable settles only after the timer has run,
// so a throw from that log call is uncaught in the worker before the lifecycle answers.
module.exports = class UncloneableLogPlugin {
  async onEnable(ctx) {
    await new Promise(resolve =>
      setTimeout(() => {
        ctx.logger.warn('timer log', { body: () => 'not cloneable' });
        ctx.logger.error('timer error', new Error('upstream down'), { body: () => 'not cloneable' });
        resolve();
      }, 0),
    );
  }

  healthCheck() {
    return { healthy: true, message: 'alive' };
  }
};
