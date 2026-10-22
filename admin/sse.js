// ----------------------------------------------------------------
// SSE: push live state updates to connected dashboards
// ----------------------------------------------------------------

const clients = new Set();

function attachSse(app) {
  app.get("/api/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");

    clients.add(res);
    req.on("close", () => clients.delete(res));
  });
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch (_) {
      clients.delete(res);
    }
  }
}

module.exports = { attachSse, broadcast };
