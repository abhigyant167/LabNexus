// ----------------------------------------------------------------
// LabNexus network diagnostic — run this on the LAB PC when
// discovery cannot find the admin server:
//
//   node diagnose.js
//
// It checks, in order: local IP config, UDP broadcast discovery,
// TCP sweep of the /24, and a manual probe of a given IP.
// ----------------------------------------------------------------

const dgram = require("dgram");
const os = require("os");
const http = require("http");

const DISCOVERY_PORT = 41888;
const MAGIC = "LABNEXUS_DISCOVER_V1";

function header(t) {
  console.log(`\n=== ${t} ===`);
}

function myIps() {
  const out = [];
  for (const [name, ifs] of Object.entries(os.networkInterfaces())) {
    for (const i of ifs || []) {
      if (i.family === "IPv4" && !i.internal) {
        out.push({ name, ...i });
      }
    }
  }
  return out;
}

function checkInterfaces() {
  header("1. Network interfaces");
  const ips = myIps();
  if (ips.length === 0) {
    console.log("  !! No IPv4 network interface found. Are you connected to wifi?");
    return [];
  }
  for (const i of ips) {
    console.log(`  ${i.name}: ${i.address} (mask ${i.netmask}, mac ${i.mac})`);
  }
  return ips;
}

function udpDiscover(timeoutMs = 5000) {
  return new Promise((resolve) => {
    header("2. UDP broadcast discovery (needs admin laptop reachable + UDP 41888 open)");
    const sock = dgram.createSocket({ type: "udp4" });
    let found = null;
    let iv = null;

    const stop = () => {
      if (iv) { clearInterval(iv); iv = null; }
      try { sock.close(); } catch (_) {}
    };

    sock.on("message", (msg, rinfo) => {
      try {
        const reply = JSON.parse(msg.toString());
        if (reply.labnexus && !found) {
          found = `http://${rinfo.address}:${reply.httpPort}`;
          console.log(`  OK — server replied from ${rinfo.address}:${reply.httpPort}`);
          stop();
          resolve(found);
        }
      } catch (_) {}
    });
    sock.on("error", () => {});

    sock.bind(() => {
      sock.setBroadcast(true);
      const targets = ["255.255.255.255"];
      for (const i of myIps()) {
        const [a, b, c, d] = i.address.split(".").map(Number);
        const [m1, m2, m3, m4] = i.netmask.split(".").map(Number);
        targets.push([a | (~m1 & 255), b | (~m2 & 255), c | (~m3 & 255), d | (~m4 & 255)].join("."));
      }
      console.log(`  Probing ${targets.join(", ")} every second for ${timeoutMs / 1000}s…`);
      const send = () => {
        if (found) return;
        targets.forEach((t) => {
          try { sock.send(Buffer.from(MAGIC), DISCOVERY_PORT, t, () => {}); } catch (_) {}
        });
      };
      send();
      iv = setInterval(send, 1000);
      setTimeout(() => {
        stop();
        if (!found) {
          console.log("  NO REPLY — broadcast is blocked, or the server is down, or UDP 41888 is firewalled.");
          resolve(null);
        }
      }, timeoutMs);
    });
  });
}

function probeHttp(ip, port = 8000, timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get({ host: ip, port, path: "/api/health", timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(body.includes("LabNexus") ? `http://${ip}:${port}` : null));
    });
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
  });
}

async function tcpSweep(timeoutMs = 15000) {
  header("3. TCP sweep of the subnet (works even when broadcast is blocked)");
  const ip = myIps()[0]?.address;
  if (!ip) return null;
  const [a, b, c] = ip.split(".").map(Number);
  console.log(`  Sweeping ${a}.${b}.${c}.1-254 on port 8000…`);
  const found = null;
  let open = 0;

  const tasks = [];
  for (let d = 1; d < 255; d++) {
    tasks.push(probeHttp(`${a}.${b}.${c}.${d}`).then((r) => { if (r) open++; return r; }));
  }
  const results = await Promise.race([
    Promise.all(tasks),
    new Promise((r) => setTimeout(() => r([]), timeoutMs)),
  ]);
  const hit = results.find(Boolean) || null;
  if (hit) {
    console.log(`  OK — found LabNexus server at ${hit}`);
  } else if (open > 0) {
    console.log(`  Some hosts answered on :8000 but not with LabNexus.`);
  } else {
    console.log("  Nothing answered on port 8000 in the whole subnet.");
    console.log("  -> the admin server is not running, or TCP 8000 is firewalled,");
    console.log("     or the laptops are on different subnets/VLANs.");
  }
  return hit;
}

async function manualProbe(target) {
  header(`4. Manual probe of ${target}`);
  const url = target.startsWith("http") ? target : `http://${target}:8000`;
  const host = url.replace(/^https?:\/\//, "").split(":")[0];
  const port = +(url.match(/:(\d+)/)?.[1] || 8000);
  const ok = await probeHttp(host, port, 2000);
  console.log(ok ? `  OK — ${url} is a LabNexus server` : `  ${url} is NOT reachable / not LabNexus`);
  return ok ? url : null;
}

async function main() {
  console.log("LabNexus network diagnostic (run on the LAB PC)");
  console.log("===============================================");

  const ips = checkInterfaces();
  const viaUdp = await udpDiscover();
  const found = viaUdp || (await tcpSweep());

  const manualArg = process.argv[2];
  if (manualArg) await manualProbe(manualArg);

  header("Summary");
  if (found) {
    console.log(`  Server found: ${found}`);
    console.log(`  -> put this in pc-agent/config.json:  "serverUrl": "${found}"`);
  } else {
    console.log("  No server found by any method. Checklist:");
    console.log("  [ ] admin server running? (cd admin && npm start)");
    console.log("  [ ] firewall rules with profile=any applied on the ADMIN laptop?");
    console.log("  [ ] both laptops on the same wifi / subnet?");
    console.log("  [ ] router AP-isolation? try a phone hotspot instead");
    if (ips.length) {
      console.log(`  [ ] is the admin laptop in ${ips[0].address.replace(/\.\d+$/, ".x")} too? (run ipconfig there)`);
    }
  }
}

main();
