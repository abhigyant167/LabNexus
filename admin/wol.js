const dgram = require("dgram");

// ----------------------------------------------------------------
// Wake-on-LAN magic packet sender.
// 6x 0xFF + target MAC repeated 16 times, UDP to port 9 (and 7 fallback).
// Sending the packet proves nothing by itself - the server must wait
// for agent-heartbeat evidence before showing the machine as awake.
// ----------------------------------------------------------------

function parseMac(mac) {
  const hex = mac.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 12) throw new Error(`invalid MAC: ${mac}`);
  return Buffer.from(hex, "hex");
}

function buildMagicPacket(macBuf) {
  const header = Buffer.alloc(6, 0xff);
  const body = Buffer.concat(Array(16).fill(macBuf));
  return Buffer.concat([header, body]);
}

// Send to every broadcast address of the server machine (covers multi-subnet
// WOL routers poorly, but works for normal LANs and phone-hotspot setups).
function sendWol(mac, { ports = [9, 7], attemptsPerPort = 3 } = {}) {
  const os = require("os");
  const macBuf = parseMac(mac);
  const pkt = buildMagicPacket(macBuf);

  const targets = new Set(["255.255.255.255"]);
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const i of ifs || []) {
      if (i.family === "IPv4" && !i.internal) {
        const [a, b, c, d] = i.address.split(".").map(Number);
        const [m1, m2, m3, m4] = i.netmask.split(".").map(Number);
        targets.add([a | (~m1 & 255), b | (~m2 & 255), c | (~m3 & 255), d | (~m4 & 255)].join("."));
      }
    }
  }

  const results = [];
  let planned = 0;
  const sock = dgram.createSocket({ type: "udp4" });
  sock.bind(() => {
    try { sock.setBroadcast(true); } catch (_) {}
    for (const port of ports) {
      for (let attempt = 0; attempt < attemptsPerPort; attempt++) {
        for (const addr of targets) {
          planned++;
          sock.send(pkt, port, addr, (err) => {
            results.push({ port, addr, attempt, ok: !err, error: err?.message });
          });
        }
      }
    }
  });

  return {
    // resolves once every send callback has fired (or 1.5s safety timeout)
    summary: () =>
      new Promise((resolve) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
          if (results.length >= planned || Date.now() - t0 > 1500) {
            clearInterval(iv);
            try { sock.close(); } catch (_) {}
            resolve({
              sent: results.filter((r) => r.ok).length,
              failed: results.filter((r) => !r.ok).length,
              planned,
              targets: [...targets],
              ports,
              detail: results,
            });
          }
        }, 50);
      }),
  };
}

module.exports = { sendWol, parseMac, buildMagicPacket };
