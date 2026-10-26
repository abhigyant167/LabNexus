// ----------------------------------------------------------------
// Engine: periodic reconcile loop
// - recomputes observed state
// - dispatches queued commands when the agent is fresh
// - expires grants
// - audits state transitions
// ----------------------------------------------------------------

const state = require("./state");

function evaluateAndDispatch() {
  const now = Date.now();

  state.expireGrants(now);

  for (const pc of state.allComputers()) {
    const before = pc.state;
    state.computeObserved(pc, now);

    // audit real state transitions
    if (before !== pc.state && pc.lastSeen !== 0) {
      state.audit("STATE_TRANSITION", {
        pcId: pc.id,
        from: before,
        to: pc.state,
        reason: pc.lastStateReason,
      });
    }
  }
}

// Per-PC FIFO command queues (in-memory; bounded to prevent unbounded memory growth)
const commandQueues = {};
const MAX_QUEUE_PER_PC = 50;

function pushCommand(pcId, cmd) {
  commandQueues[pcId] = commandQueues[pcId] || [];
  commandQueues[pcId].push(cmd);
  if (commandQueues[pcId].length > MAX_QUEUE_PER_PC) {
    commandQueues[pcId].shift();
  }
}

function popCommand(pcId) {
  const q = commandQueues[pcId];
  if (!q || q.length === 0) return null;
  const cmd = q.shift();
  cmd.status = "SENT";
  state.audit("COMMAND_SENT", { pcId, command: cmd.command, id: cmd.id });
  return cmd;
}

function startTicking(evaluateAndDispatchFn, broadcastStateFn, expireGrantsFn) {
  setInterval(evaluateAndDispatchFn, 2000);
  setInterval(broadcastStateFn, 2000);
}

module.exports = {
  evaluateAndDispatch,
  pushCommand,
  popCommand,
  startTicking,
};
