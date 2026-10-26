const dgram = require("dgram");

// ----------------------------------------------------------------
// UDP discovery responder.
// The pc-agent broadcasts "LABNEXUS_DISCOVER" on the LAN; the admin
// laptop replies with its own address + port. The agent then knows
// where the server is even after the admin IP changes (DHCP).
// ----------------------------------------------------------------

const MAGIC = "LABNEXUS_DISCOVER_V1";

function startDiscoveryResponder(port = 41888, httpPort = 8000) {
  try {
    const sock = dgram.createSocket({ type: "udp4" });

    sock.on("message", (msg, rinfo) => {
      try {
        if (msg.toString() !== MAGIC) return;
        const reply = Buffer.from(JSON.stringify({
          labnexus: true,
          httpPort,
          ts: Date.now(),
        }));
        sock.send(reply, rinfo.port, rinfo.address, () => {
          console.log(`Discovery: replied to ${rinfo.address}:${rinfo.port}`);
        });
      } catch (_) {}
    });

    sock.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`Discovery UDP port ${port} is already in use (another LabNexus server?).`);
        console.error("The HTTP server will still start; agents may need serverUrl set in config.json.");
        return; // keep the HTTP server alive
      }
      console.error("Discovery socket error:", err.message);
    });

    sock.bind(port, () => {
      try { sock.setBroadcast(true); } catch (_) {}
      console.log(`Discovery responder listening on UDP ${port}`);
    });

    return sock;
  } catch (err) {
    console.error(`Discovery socket could not be started (${err.message}) - agents may need serverUrl in config.json`);
    return null;
  }
}

module.exports = { startDiscoveryResponder, MAGIC };
