import test from "node:test";
import assert from "node:assert/strict";
import { createDevice, exec, prompt } from "../engine/device.js";
import { type7, runningConfig } from "../engine/config.js";
import { wildcardBits, network, expandIpv6, compressIpv6, eui64 } from "../engine/ip.js";
import { normalize, expandRange } from "../engine/iface.js";

const router = () => {
  const d = createDevice({ name: "R1", type: "router", hostname: "R1" });
  exec(d, "enable");
  return d;
};

test("abbreviations are accepted the way IOS accepts them", () => {
  const d = router();
  exec(d, "conf t");
  assert.equal(prompt(d), "R1(config)#");
  exec(d, "int g0/0");
  assert.equal(prompt(d), "R1(config-if)#");
  exec(d, "ip add 10.0.0.1 255.255.255.0");
  exec(d, "no shut");
  assert.equal(d.interfaces["GigabitEthernet0/0"].ip, "10.0.0.1");
  assert.equal(d.interfaces["GigabitEthernet0/0"].shutdown, false);
});

test("an ambiguous prefix, a bad keyword and a short command get IOS's errors", () => {
  const d = router();
  assert.match(exec(d, "s"), /% Ambiguous command/);
  assert.match(exec(d, "show ip intx brief"), /\^\n% Invalid input detected at '\^' marker\./);
  exec(d, "configure terminal");
  assert.match(exec(d, "hostname"), /% Incomplete command\./);
});

test("config modes, do, and leaving them", () => {
  const d = router();
  exec(d, "configure terminal");
  exec(d, "router ospf 1");
  assert.equal(prompt(d), "R1(config-router)#");
  // a global command from a sub-mode drops back to config, as IOS does
  exec(d, "hostname EDGE");
  assert.equal(prompt(d), "EDGE(config)#");
  assert.match(exec(d, "do show running-config | include hostname"), /hostname EDGE/);
  exec(d, "end");
  assert.equal(prompt(d), "EDGE#");
});

test("the running config is written back in IOS form", () => {
  const d = router();
  exec(d, "configure terminal");
  exec(d, "interface g0/1");
  exec(d, "description to ISP");
  exec(d, "ip address 203.0.113.2 255.255.255.252");
  const run = runningConfig(d);
  assert.match(run, /interface GigabitEthernet0\/1\n description to ISP\n ip address 203\.0\.113\.2 255\.255\.255\.252\n shutdown/);
});

test("type 7 is the real reversible cipher", () => {
  assert.equal(type7("cisco"), "02050D480809");
});

test("address helpers", () => {
  assert.equal(wildcardBits("0.0.0.255"), 24);
  assert.equal(network("192.168.1.77", 26), "192.168.1.64");
  assert.equal(compressIpv6(expandIpv6("2001:0db8:0000:0000:0000:0000:0000:0001")), "2001:DB8::1");
  assert.equal(eui64("2001:db8:1::", "0050.7966.6800"), expandIpv6("2001:db8:1:0:250:79ff:fe66:6800"));
});

test("interface names and ranges", () => {
  assert.equal(normalize("fa0/1"), "FastEthernet0/1");
  assert.equal(normalize("Gi0/0.10"), "GigabitEthernet0/0.10");
  assert.deepEqual(expandRange("fa0/1 - 3, g0/1"), ["FastEthernet0/1", "FastEthernet0/2", "FastEthernet0/3", "GigabitEthernet0/1"]);
});

test("a PC's terminal answers like its operating system", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const lab = (id) => buildLab(LABS.find((l) => l.id === id));
  const win = lab("win-ipconfig").devices.PC1;
  assert.equal(prompt(win), "C:\\Users\\student>");
  assert.match(exec(win, "IPCONFIG"), /IPv4 Address\. \. \. \. \. \. \. \. \. \. \. : 10\.10\.10\.21/);
  assert.match(exec(win, "traceroute 10.10.10.1"), /'traceroute' is not recognized as an internal or external command/);
  const lnx = lab("linux-ip-route").devices.PC1;
  assert.match(exec(lnx, "ip r"), /^default via 10\.10\.10\.1 dev eth0/);
  assert.equal(exec(lnx, "ipconfig"), "ipconfig: command not found");
  const mac = lab("mac-ifconfig").devices.PC1;
  assert.match(exec(mac, "ifconfig en0"), /netmask 0xffffff00/);
});

test("a DHCP client gets APIPA with no server, and a lease once a pool exists", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const l = buildLab(LABS.find((x) => x.id === "win-apipa"));
  const pc = l.devices.PC1, r1 = l.devices.R1;
  assert.match(exec(pc, "ipconfig"), /Autoconfiguration IPv4 Address\. \. : 169\.254\./);
  assert.match(exec(pc, "ipconfig /renew"), /unable to contact your DHCP server/);
  for (const line of ["enable", "configure terminal", "ip dhcp pool LAN", "network 10.10.10.0 255.255.255.0", "default-router 10.10.10.1"]) exec(r1, line);
  assert.match(exec(pc, "ipconfig /renew"), /IPv4 Address[ .]+: 10\.10\.10\.\d+\n[^\n]*\n\s+Default Gateway[ .]+: 10\.10\.10\.1/);
});

test("with no route off the subnet, a PC says so instead of timing out", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const win = buildLab(LABS.find((x) => x.id === "win-apipa")).devices.PC1;
  assert.match(exec(win, "ping 10.10.20.80"), /PING: transmit failed\. General failure\./);
  assert.equal(exec(win, "tracert 10.10.20.80"), "Unable to contact IP driver. General failure.");
  const lnx = buildLab(LABS.find((x) => x.id === "linux-ip-route")).devices.PC1;
  lnx.host.gw = null;
  assert.equal(exec(lnx, "ping -c 4 10.10.20.80"), "ping: connect: Network is unreachable");
  assert.match(exec(lnx, "ping -c 1 10.10.10.1"), /1 received/);
});

test("root primary goes under a lower root, or says it cannot", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const l = buildLab(LABS.find((x) => x.id === "stp-priority"));
  for (const [name, p] of [["SW3", 8192], ["SW1", null]]) {
    const d = l.devices[name];
    exec(d, "enable");
    exec(d, "configure terminal");
    if (p) exec(d, `spanning-tree vlan 1 priority ${p}`);
  }
  exec(l.devices.SW1, "spanning-tree vlan 1 root primary");
  assert.equal(l.devices.SW1.stp.vlans[1].priority, 4096);
  exec(l.devices.SW3, "spanning-tree vlan 1 priority 0");
  assert.match(exec(l.devices.SW1, "spanning-tree vlan 1 root primary"), /% Failed to make the bridge root for vlan 1/);
});

test("spanning tree blocks one port of a triangle, on the switch with the higher bridge ID", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const { stpPorts } = await import("../engine/net.js");
  const l = buildLab(LABS.find((x) => x.id === "stp-read"));
  const roles = (s) => Object.fromEntries(stpPorts(l.devices[s], 1).ports.map((p) => [p.f.name, `${p.role} ${p.state}`]));
  assert.deepEqual(roles("SW1"), { "GigabitEthernet0/1": "Desg FWD", "GigabitEthernet0/2": "Desg FWD" });
  assert.deepEqual(roles("SW2"), { "GigabitEthernet0/1": "Root FWD", "GigabitEthernet0/2": "Desg FWD" });
  assert.deepEqual(roles("SW3"), { "GigabitEthernet0/1": "Root FWD", "GigabitEthernet0/2": "Altn BLK" });
  exec(l.devices.SW3, "enable");
  assert.match(exec(l.devices.SW3, "show spanning-tree vlan 1"), /Cost {8}4\n {13}Port {8}25 \(GigabitEthernet0\/1\)/);
});

test("a PC reaches its gateway only through the right VLAN, trunk and subinterface", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { cfg, R, S, HOST } = await import("../labs/kit.js");
  const def = (pcVlan, allowed) => ({
    id: "t", tasks: [], solution: {},
    devices: [
      R("R1", 50, 10, cfg("interface g0/0", "no shutdown", "interface g0/0.10", "encapsulation dot1q 10", "ip address 10.1.10.1 255.255.255.0", "interface g0/0.20", "encapsulation dot1q 20", "ip address 10.1.20.1 255.255.255.0")),
      S("SW1", 50, 30, cfg("vlan 10", "vlan 20", "interface fa0/1", "switchport mode access", `switchport access vlan ${pcVlan}`, "interface g0/1", "switchport mode trunk", ...(allowed ? [`switchport trunk allowed vlan ${allowed}`] : []))),
      HOST("PC1", 50, 50, "windows", { ip: "10.1.10.11/24", gateway: "10.1.10.1" }),
      HOST("PC2", 70, 50, "linux", { ip: "10.1.20.11/24", gateway: "10.1.20.1" }),
    ],
    links: [["R1", "g0/0", "SW1", "g0/1"], ["SW1", "fa0/1", "PC1", "fa0"], ["SW1", "fa0/2", "PC2", "fa0"]],
  });
  const ok = (l) => /Reply from [\d.]+: bytes=/.test(exec(l.devices.PC1, "ping 10.1.10.1"));
  assert.equal(ok(buildLab(def(10))), true);
  assert.equal(ok(buildLab(def(20))), false, "wrong access VLAN");
  assert.equal(ok(buildLab(def(10, "20"))), false, "VLAN not allowed on the trunk");
  // PC2 sits on an access port left in VLAN 1, so it reaches nothing
  const l = buildLab(def(10));
  assert.match(exec(l.devices.PC2, "ping -c 1 10.1.20.1"), /0 received/);
  // inter-VLAN: PC1 to the other subinterface's address works through the router
  assert.equal(/Reply from [\d.]+: bytes=/.test(exec(l.devices.PC1, "ping 10.1.20.1")), true);
});

test("an HSRP virtual IP answers as a gateway, with the virtual MAC", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const { cfg, HOST } = await import("../labs/kit.js");
  const base = LABS.find((x) => x.id === "hsrp-priority");
  const def = { ...base, devices: base.devices.map((d) => (d.name === "PC1" ? HOST("PC1", d.x, d.y, "windows", { ip: "10.10.10.50/24", gateway: "10.10.10.1" }) : d)) };
  const l = buildLab(def);
  const pc = l.devices.PC1;
  assert.match(exec(pc, "ping 10.10.10.1"), /Reply from [\d.]+: bytes=/);
  assert.match(exec(pc, "arp -a"), /10\.10\.10\.1\s+00-00-0c-07-ac-01\s+dynamic/);
});

test("a ping off the subnet needs a route there and a route back", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { cfg, R, HOST } = await import("../labs/kit.js");
  const def = (backRoute) => ({
    id: "t", tasks: [], solution: {},
    devices: [
      R("R1", 20, 20, cfg("interface g0/0", "ip address 10.1.1.1 255.255.255.0", "no shutdown", "interface g0/1", "ip address 10.0.12.1 255.255.255.252", "no shutdown", "ip route 10.2.2.0 255.255.255.0 10.0.12.2")),
      R("R2", 70, 20, cfg("interface g0/0", "ip address 10.2.2.1 255.255.255.0", "no shutdown", "interface g0/1", "ip address 10.0.12.2 255.255.255.252", "no shutdown", ...(backRoute ? ["ip route 10.1.1.0 255.255.255.0 10.0.12.1"] : []))),
      HOST("PC1", 20, 50, "linux", { ip: "10.1.1.10/24", gateway: "10.1.1.1" }),
      HOST("PC2", 70, 50, "windows", { ip: "10.2.2.10/24", gateway: "10.2.2.1" }),
    ],
    links: [["R1", "g0/1", "R2", "g0/1"], ["R1", "g0/0", "PC1", "fa0"], ["R2", "g0/0", "PC2", "fa0"]],
  });
  assert.match(exec(buildLab(def(false)).devices.PC1, "ping -c 2 10.2.2.10"), /0 received/);
  const l = buildLab(def(true));
  assert.match(exec(l.devices.PC1, "ping -c 2 10.2.2.10"), /[12] received/);
  assert.match(exec(l.devices.PC1, "traceroute 10.2.2.10"), / 1  10\.1\.1\.1 .*\n 2  10\.0\.12\.2 .*\n 3  10\.2\.2\.10 /);
});

test("ospf routes come from the adjacencies that are up, and beat a floating static", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { cfg, R, PC } = await import("../labs/kit.js");
  const { routeTable } = await import("../engine/show.js");
  const def = (area2) => ({
    id: "t", tasks: [], solution: {},
    devices: [
      R("R1", 20, 20, cfg("interface g0/1", "ip address 10.0.12.1 255.255.255.252", "no shutdown", "ip route 10.2.2.0 255.255.255.0 10.0.12.2 200", "router ospf 1", "network 10.0.12.0 0.0.0.3 area 0")),
      R("R2", 70, 20, cfg("interface g0/0", "ip address 10.2.2.1 255.255.255.0", "no shutdown", "interface g0/1", "ip address 10.0.12.2 255.255.255.252", "no shutdown", "interface lo0", "ip address 2.2.2.2 255.255.255.255", "router ospf 1", `network 10.0.12.0 0.0.0.3 area ${area2}`, "network 10.2.2.0 0.0.0.255 area 0", "network 2.2.2.2 0.0.0.0 area 0")),
      PC("PC2", 70, 50, "10.2.2.10/24", "10.2.2.1"),
    ],
    // (a LAN interface with nothing plugged in is down, and ospf leaves it out)
    links: [["R1", "g0/1", "R2", "g0/1"], ["R2", "g0/0", "PC2", "fa0"]],
  });
  const up = routeTable(buildLab(def(0)).devices.R1);
  assert.deepEqual(up.filter((r) => r.code === "O").map((r) => `${r.net}/${r.bits} [${r.ad}/${r.metric}] via ${r.via}`).sort(), ["10.2.2.0/24 [110/2] via 10.0.12.2", "2.2.2.2/32 [110/2] via 10.0.12.2"]);
  assert.ok(!up.some((r) => r.code === "S"), "the floating static stays out");
  // an area mismatch: no adjacency, no ospf routes, the floating static comes in
  const down = routeTable(buildLab(def(1)).devices.R1);
  assert.ok(!down.some((r) => r.code.startsWith("O")));
  assert.ok(down.some((r) => r.code === "S" && r.net === "10.2.2.0" && r.ad === 200));
});

test("a private address gets no answer from the Internet without NAT", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const l = buildLab(LABS.find((x) => x.id === "ch-edge-policy"));
  const r1 = l.devices.R1;
  for (const c of ["enable", "configure terminal", "ip route 0.0.0.0 0.0.0.0 203.0.113.1"]) exec(r1, c);
  assert.doesNotMatch(exec(l.devices.PC1, "ping 8.8.8.8"), /bytes=/);
  for (const c of ["interface g0/0", "ip nat inside", "interface g0/1", "ip nat outside", "exit", "access-list 1 permit 192.168.10.0 0.0.0.255", "ip nat inside source list 1 interface g0/1 overload"]) exec(r1, c);
  assert.match(exec(l.devices.PC1, "ping 8.8.8.8"), /Reply from [\d.]+: bytes=/);
  // the ping left its translation behind, and clearing removes it
  exec(r1, "end");
  assert.match(exec(r1, "show ip nat translations"), /icmp 203\.0\.113\.\d+:1\s+192\.168\.10\.11:1\s+8\.8\.8\.8:1\s+8\.8\.8\.8:1/);
  assert.match(exec(r1, "show ip nat statistics"), /Total active translations: 1 \(0 static, 1 dynamic; 1 extended\)/);
  exec(r1, "clear ip nat translation *");
  assert.doesNotMatch(exec(r1, "show ip nat translations"), /icmp/);
});

test("a port-channel of two gig links costs 3 in spanning tree and is port 65", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, cfg } = await import("../labs/kit.js");
  const po = ["interface range g0/1 - 2", "channel-group 1 mode active", "interface port-channel 1", "switchport mode trunk"];
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [S("SW1", 20, 20, cfg(...po, "exit", "spanning-tree vlan 1 root primary")), S("SW2", 70, 20, cfg(...po))], links: [["SW1", "g0/1", "SW2", "g0/1"], ["SW1", "g0/2", "SW2", "g0/2"]] });
  const out = exec(l.devices.SW2, "show spanning-tree vlan 1");
  assert.match(out, /Po1\s+Root FWD 3\s+128\.65/);
  assert.match(out, /Cost\s+3\n\s+Port\s+65 \(Port-channel1\)/);
  assert.match(exec(l.devices.SW2, "show spanning-tree interface g0/1"), /no spanning tree info available for GigabitEthernet0\/1/);
});

test("a DHCP lease shows on the server until the PC releases it", async () => {
  const { buildLab, runSolution } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const l = buildLab(LABS.find((x) => x.id === "ch-dhcp-sites"));
  runSolution(l);
  const r1 = l.devices.R1;
  exec(r1, "end");
  assert.match(exec(r1, "show ip dhcp binding"), /10\.20\.20\.21\s+0100\.5079\.6668\.42/);
  assert.match(exec(r1, "show ip dhcp pool BRANCH"), /10\.20\.20\.22\s+10\.20\.20\.1\s+- 10\.20\.20\.254\s+1\s+\/ 20\s+\/ 254/);
  assert.doesNotMatch(exec(r1, "show ip dhcp pool BRANCH"), /Pool HQ/);
  exec(l.devices.PC2, "ipconfig /release");
  assert.doesNotMatch(exec(r1, "show ip dhcp binding"), /10\.20\.20\.21/);
  // the server sends its Offer to the relay's address: without a route back
  // to the branch, the branch gets nothing
  for (const c of ["configure terminal", "no ip route 10.20.20.0 255.255.255.0 10.0.12.2", "end"]) exec(r1, c);
  assert.match(exec(l.devices.PC2, "ipconfig /renew"), /unable to contact your DHCP server/);
});

test("a member that differs from its port-channel is suspended, and po settings reach the members", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, cfg } = await import("../labs/kit.js");
  const po = ["interface range fa0/23 - 24", "switchport mode trunk", "channel-group 1 mode active"];
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [S("SW1", 20, 20, cfg(...po)), S("SW2", 70, 20, cfg(...po, "interface fa0/24", "switchport trunk allowed vlan 10"))], links: [["SW1", "fa0/23", "SW2", "fa0/23"], ["SW1", "fa0/24", "SW2", "fa0/24"]] });
  const sw2 = l.devices.SW2;
  assert.match(exec(sw2, "show etherchannel summary"), /Po1\(SU\)\s+LACP\s+Fa0\/23\(P\) Fa0\/24\(s\)/);
  for (const c of ["enable", "configure terminal", "interface port-channel 1", "switchport trunk allowed vlan 10,20", "end"]) exec(sw2, c);
  assert.match(exec(sw2, "show etherchannel summary"), /Fa0\/23\(P\) Fa0\/24\(P\)/);
  assert.match(exec(sw2, "show running-config interface fa0/24"), /switchport trunk allowed vlan 10,20/);
});

test("show ip route groups subnets under their classful network, like IOS 15", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, PC: pc, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 20, 20), R("R2", 70, 20, cfg("interface g0/1", "ip address 10.0.12.2 255.255.255.252", "no shutdown")), pc("PC1", 20, 60, "192.168.1.10/24", "192.168.1.1")], links: [["R1", "g0/1", "R2", "g0/1"], ["R1", "g0/0", "PC1", "fa0"]] });
  const r = l.devices.R1;
  exec(r, "enable");
  for (const c of ["configure terminal", "interface g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "interface g0/1", "ip address 10.0.12.1 255.255.255.252", "no shutdown", "exit", "ip route 192.168.4.0 255.255.255.0 10.0.12.2", "ip route 0.0.0.0 0.0.0.0 10.0.12.2", "end"]) exec(r, c);
  const out = exec(r, "show ip route");
  assert.match(out, /\nS\*    0\.0\.0\.0\/0 \[1\/0\] via 10\.0\.12\.2/);
  assert.match(out, /\n      10\.0\.0\.0\/8 is variably subnetted, 2 subnets, 2 masks\nC        10\.0\.12\.0\/30/);
  assert.match(out, /\n      192\.168\.1\.0\/24 is variably subnetted, 2 subnets, 2 masks\n/);
  assert.match(out, /\nS     192\.168\.4\.0\/24 \[1\/0\] via 10\.0\.12\.2/);
  // a filtered view keeps the legend and the headings
  const st = exec(r, "show ip route static");
  assert.match(st, /^Codes:/);
  assert.doesNotMatch(st, /directly connected/);
});

test("a router's ping loses the first packet to ARP, needs a real target and a route back", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const l = buildLab(LABS.find((x) => x.id === "ch-backup-oneway"));
  const { R1, R4 } = l.devices;
  for (const c of ["enable", "configure terminal", "ip route 192.168.4.0 255.255.255.0 10.0.12.2", "end"]) exec(R1, c);
  assert.match(exec(R1, "ping 192.168.1.10"), /\n\.!!!!\nSuccess rate is 80 percent \(4\/5\)/);
  assert.match(exec(R1, "ping 192.168.1.10"), /\n!!!!!\nSuccess rate is 100 percent/);
  assert.match(exec(R1, "ping 192.168.1.99"), /Success rate is 0 percent/);
  // R4 has no route back to 10.0.12.1, so neither it nor PC4 answers
  assert.match(exec(R1, "ping 192.168.4.10"), /Success rate is 0 percent/);
  assert.match(exec(R1, "traceroute 192.168.4.10"), /  1 10\.0\.12\.2 .*\n  2  \*  \*  \*/);
  for (const c of ["enable", "configure terminal", "ip route 0.0.0.0 0.0.0.0 10.0.24.1", "end"]) exec(R4, c);
  assert.match(exec(R1, "traceroute 192.168.4.10"), /  2 10\.0\.24\.2 .*\n  3 192\.168\.4\.10 /);
});

test("ACLs filter pings and DHCP, and the first matching entry decides", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({
    id: "t", tasks: [], solution: {},
    devices: [
      R("R1", 50, 0, cfg("interface g0/0", "ip address 10.1.1.1 255.255.255.0", "no shutdown", "interface g0/1", "ip address 10.2.2.1 255.255.255.0", "no shutdown", "exit", "ip dhcp pool LAN", "network 10.1.1.0 255.255.255.0", "default-router 10.1.1.1")),
      HOST("PC1", 20, 40, "windows", { dhcp: true, mac: "0050.7966.6891" }),
      HOST("PC2", 80, 40, "windows", { ip: "10.2.2.10/24", gateway: "10.2.2.1", mac: "0050.7966.6892" }),
    ],
    links: [["R1", "g0/0", "PC1", "fa0"], ["R1", "g0/1", "PC2", "fa0"]],
  });
  const { R1, PC1, PC2 } = l.devices;
  const cmds = (...lines) => lines.forEach((c) => exec(R1, c));
  assert.match(exec(PC1, "ipconfig /renew"), /10\.1\.1\.\d+/);
  assert.match(exec(PC1, "ping 10.2.2.10"), /Reply from [\d.]+: bytes=/);
  // outbound towards PC2: echoes from 10.1.1.0/24 dropped
  cmds("enable", "configure terminal", "access-list 101 deny icmp 10.1.1.0 0.0.0.255 any echo", "access-list 101 permit ip any any", "interface g0/1", "ip access-group 101 out");
  assert.doesNotMatch(exec(PC1, "ping 10.2.2.10"), /bytes=/);
  // the reply direction is a different packet: PC2's own pings still work
  assert.match(exec(PC2, "ping 10.1.1.1"), /Reply from [\d.]+: bytes=/);
  cmds("no ip access-group 101 out", "exit");
  assert.match(exec(PC1, "ping 10.2.2.10"), /Reply from [\d.]+: bytes=/);
  // inbound on the LAN, permitting only the subnet: the Discover comes from 0.0.0.0
  cmds("access-list 10 permit 10.1.1.0 0.0.0.255", "interface g0/0", "ip access-group 10 in", "end");
  exec(PC1, "ipconfig /release");
  assert.match(exec(PC1, "ipconfig /renew"), /unable to contact your DHCP server/);
});

test("ACL entries print well-known ports by name, and no permit|deny removes one", () => {
  const r = router();
  for (const c of ["configure terminal", "ip access-list extended EDGE", "permit tcp any host 192.0.2.10 eq 80", "permit udp any any eq 53", "permit tcp any any eq 443", "permit icmp any any echo-reply", "no permit icmp any any echo-reply", "end"]) exec(r, c);
  const out = exec(r, "show access-lists EDGE");
  assert.match(out, /10 permit tcp any host 192\.0\.2\.10 eq www/);
  assert.match(out, /20 permit udp any any eq domain/);
  assert.match(out, /30 permit tcp any any eq 443/);
  assert.doesNotMatch(out, /echo-reply/);
});

test("telnet and ssh connect only when the vty lines take them", async () => {
  const { buildLab, runSolution } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const l = buildLab(LABS.find((x) => x.id === "ch-access-hardening"));
  runSolution(l);
  const { ADMIN, PC1, R1, SW1 } = l.devices;
  exec(R1, "end");
  // the admin PC is in the management subnet; PC1 is not (access-class 10)
  assert.match(exec(ADMIN, "ssh netadmin@192.168.99.2"), /The authenticity of host '192\.168\.99\.2 \(192\.168\.99\.2\)' can't be established\.\nRSA key fingerprint is SHA256:[A-Za-z0-9+/]{43}\./);
  assert.match(exec(ADMIN, "yes"), /Warning: Permanently added '192\.168\.99\.2' \(RSA\)/);
  assert.equal(prompt(ADMIN), "netadmin@192.168.99.2's password: ");
  exec(ADMIN, "\u0003");
  ADMIN.pending = null;
  assert.match(exec(PC1, "ssh netadmin@192.168.99.2"), /port 22: Connection refused/);
  assert.match(exec(PC1, "ping 192.168.99.2"), /Reply from [\d.]+: bytes=/);
  // transport input ssh: telnet is refused
  assert.match(exec(R1, "telnet 192.168.99.2"), /Trying 192\.168\.99\.2 \.\.\.\n% Connection refused by remote host/);
  assert.equal(exec(R1, "ssh -l netadmin 192.168.99.2"), "");
  assert.equal(prompt(R1), "Password: ");
  R1.pending = null;
  // no keys, no SSH; nothing on the other end, a timeout
  for (const c of ["configure terminal", "crypto key zeroize rsa", "end"]) exec(SW1, c);
  assert.match(exec(ADMIN, "ssh netadmin@192.168.99.2"), /Connection refused/);
  assert.match(exec(R1, "ssh -l netadmin 192.168.99.77"), /% Connection timed out; remote host not responding/);
});

test("a Layer 2 switch pings through its SVI and default gateway", async () => {
  const { buildLab, runSolution } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const l = buildLab(LABS.find((x) => x.id === "ch-access-hardening"));
  runSolution(l);
  const sw = l.devices.SW1;
  exec(sw, "end");
  assert.match(exec(sw, "ping 192.168.99.1"), /Success rate is (80|100) percent/);
  assert.match(exec(sw, "ping 192.168.10.11"), /Success rate is (80|100) percent/);
  assert.match(exec(sw, "traceroute 192.168.10.11"), /  1 192\.168\.99\.1 .*\n  2 192\.168\.10\.11 /);
  assert.match(exec(sw, "ping 192.168.99.77"), /Success rate is 0 percent/);
});

test("ping with a source tests the path from that interface", async () => {
  const { buildLab, runSolution } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const l = buildLab(LABS.find((x) => x.id === "extended-ping"));
  const r1 = l.devices.R1;
  exec(r1, "enable");
  // R2 has no route to 10.1.1.0/24 yet: the plain ping works, the LAN's doesn't
  assert.match(exec(r1, "ping 10.3.3.1"), /Success rate is (80|100) percent/);
  assert.match(exec(r1, "ping 10.3.3.1 source g0/0"), /Packet sent with a source address of 10\.1\.1\.1 \n\.\.\.\.\.\nSuccess rate is 0 percent/);
  assert.match(exec(r1, "ping 10.3.3.1 source 10.9.9.9"), /% Invalid source address- IP address not on any of our up interfaces/);
  runSolution(l);
  assert.match(exec(r1, "ping 10.3.3.1 source g0/0"), /!!!!!\nSuccess rate is 100 percent/);
});

test("a lab's extern hosts answer through the routers", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const l = buildLab(LABS.find((x) => x.id === "sim-dns-fault"));
  assert.match(exec(l.devices.PC1, "ping -c 1 10.10.20.80"), /1 received, 0% packet loss/);
});

test("NTP syncs only to a server that answers and has time itself", async () => {
  const { buildLab, runSolution } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const l = buildLab(LABS.find((x) => x.id === "ntp-master"));
  const { R1, R2 } = l.devices;
  // R2 points at R1 before R1 has any time: nothing to sync to
  for (const c of ["enable", "configure terminal", "ntp server 10.0.0.1", "end"]) exec(R2, c);
  assert.match(exec(R2, "show ntp status"), /Clock is unsynchronized, stratum 16/);
  assert.match(exec(R2, "show ntp associations"), / ~10\.0\.0\.1\s+\.INIT\.\s+16/);
  runSolution(l);
  exec(R2, "end");
  assert.match(exec(R2, "show ntp status"), /Clock is synchronized, stratum 4, reference is 10\.0\.0\.1/);
  // a server nobody owns never answers
  for (const c of ["configure terminal", "no ntp server 10.0.0.1", "ntp server 10.0.0.99", "end"]) exec(R2, c);
  assert.match(exec(R2, "show ntp status"), /unsynchronized/);
  void R1;
});

test("port security learns sticky MACs, and a violation drops or err-disables", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, S, HOST, cfg } = await import("../labs/kit.js");
  const def = (violation) => ({
    id: "t", tasks: [], solution: {},
    devices: [
      R("R1", 50, 0, cfg("interface g0/0", "ip address 10.1.1.1 255.255.255.0", "no shutdown")),
      S("SW1", 50, 30, cfg("interface fa0/1", "switchport mode access", "switchport port-security", "switchport port-security mac-address sticky", `switchport port-security violation ${violation}`)),
      HOST("PC1", 20, 60, "windows", { ip: "10.1.1.11/24", gateway: "10.1.1.1", mac: "0050.7966.6871" }),
      HOST("PC2", 80, 60, "windows", { ip: "10.1.1.12/24", gateway: "10.1.1.1", mac: "0050.7966.6872" }),
    ],
    links: [["SW1", "g0/1", "R1", "g0/0"], ["SW1", "fa0/1", "PC1", "fa0"]],
  });
  for (const violation of ["restrict", "shutdown"]) {
    const l = buildLab(def(violation));
    const { SW1, PC1, PC2 } = l.devices;
    assert.match(exec(PC1, "ping 10.1.1.1"), /Reply from [\d.]+: bytes=/);
    exec(SW1, "enable");
    assert.match(exec(SW1, "show running-config interface fa0/1"), /switchport port-security mac-address sticky 0050\.7966\.6871/);
    // another device on the same port (moved from PC1's cable)
    PC2.links.FastEthernet0 = PC1.links.FastEthernet0;
    delete PC1.links.FastEthernet0;
    SW1.links["FastEthernet0/1"] = { device: PC2, iface: "FastEthernet0" };
    assert.doesNotMatch(exec(PC2, "ping 10.1.1.1"), /bytes=/);
    const ps = exec(SW1, "show port-security interface fa0/1");
    assert.match(ps, /Security Violation Count {3}: 1/);
    assert.match(ps, violation === "shutdown" ? /Secure-shutdown/ : /Secure-up/);
    assert.match(exec(SW1, "show logging"), /%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address 0050\.7966\.6872 on port FastEthernet0\/1\./);
  }
});

test("HSRP routers only pair up within the same group number", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, S, cfg } = await import("../labs/kit.js");
  const def = (g2) => ({ id: "t", tasks: [], solution: {}, devices: [
    R("R1", 20, 0, cfg("interface g0/0", "ip address 10.1.20.2 255.255.255.0", "standby 20 ip 10.1.20.1", "standby 20 priority 110", "no shutdown")),
    R("R2", 80, 0, cfg("interface g0/0", "ip address 10.1.20.3 255.255.255.0", `standby ${g2} ip 10.1.20.1`, "no shutdown")),
    S("SW1", 50, 30)], links: [["R1", "g0/0", "SW1", "fa0/1"], ["R2", "g0/0", "SW1", "fa0/2"]] });
  const same = buildLab(def(20));
  exec(same.devices.R2, "enable");
  assert.match(exec(same.devices.R2, "show standby brief"), /Gi0\/0\s+20\s+100\s+Standby 10\.1\.20\.2\s+local/);
  const split = buildLab(def(21));
  exec(split.devices.R2, "enable");
  assert.match(exec(split.devices.R2, "show standby brief"), /Gi0\/0\s+21\s+100\s+Active\s+local\s+unknown/);
});

test("IPv6 ping from a router needs routes both ways and ipv6 unicast-routing in the middle", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    R("R1", 10, 0, cfg("ipv6 unicast-routing", "interface g0/1", "ipv6 address 2001:db8:12::1/64", "no shutdown", "exit", "ipv6 route ::/0 2001:db8:12::2")),
    R("R2", 50, 0, cfg("interface g0/1", "ipv6 address 2001:db8:12::2/64", "no shutdown", "interface g0/2", "ipv6 address 2001:db8:23::2/64", "no shutdown")),
    R("R3", 90, 0, cfg("ipv6 unicast-routing", "interface g0/2", "ipv6 address 2001:db8:23::3/64", "no shutdown"))],
    links: [["R1", "g0/1", "R2", "g0/1"], ["R2", "g0/2", "R3", "g0/2"]] });
  const { R1, R2, R3 } = l.devices;
  exec(R1, "enable");
  assert.match(exec(R1, "ping 2001:db8:12::2"), /!!!!!\nSuccess rate is 100 percent/);
  // R2 does not route IPv6 yet
  assert.match(exec(R1, "ping 2001:db8:23::3"), /\.\.\.\.\.\nSuccess rate is 0 percent/);
  for (const c of ["enable", "configure terminal", "ipv6 unicast-routing", "end"]) exec(R2, c);
  // R3 has no route back to 2001:db8:12::/64
  assert.match(exec(R1, "ping ipv6 2001:db8:23::3"), /Success rate is 0 percent/);
  for (const c of ["enable", "configure terminal", "ipv6 route 2001:db8:12::/64 2001:db8:23::2", "end"]) exec(R3, c);
  assert.match(exec(R1, "ping 2001:db8:23::3"), /Success rate is 100 percent/);
  assert.match(exec(R1, "traceroute 2001:db8:23::3"), /  1 2001:DB8:12::2 .*\n  2 2001:DB8:23::3 /);
  assert.match(exec(R3, "ping 2001:db8:99::1"), /% No valid route for destination/);
});

test("OSPF elects one DR and BDR per segment, and DROTHERs stay at 2WAY", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, S, cfg } = await import("../labs/kit.js");
  const r = (n, i, extra = []) => R(n, i * 20, 0, cfg("interface g0/0", `ip address 10.0.0.${i} 255.255.255.0`, "no shutdown", ...extra, "router ospf 1", `router-id ${i}.${i}.${i}.${i}`, "network 10.0.0.0 0.0.0.255 area 0"));
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [r("R1", 1, ["ip ospf priority 0"]), r("R2", 2), r("R3", 3), r("R4", 4, ["ip ospf priority 50"]), S("SW1", 50, 40)], links: [1, 2, 3, 4].map((i) => [`R${i}`, "g0/0", "SW1", `fa0/${i}`]) });
  const { R1, R2, R3 } = l.devices;
  for (const d of [R1, R2, R3]) exec(d, "enable");
  const n1 = exec(R1, "show ip ospf neighbor");
  assert.match(n1, /2\.2\.2\.2\s+1\s+2WAY\/DROTHER/);
  assert.match(n1, /3\.3\.3\.3\s+1\s+FULL\/BDR/);
  assert.match(n1, /4\.4\.4\.4\s+50\s+FULL\/DR /);
  assert.match(exec(R3, "show ip ospf neighbor"), /2\.2\.2\.2\s+1\s+FULL\/DROTHER/);
  const i2 = exec(R2, "show ip ospf interface g0/0");
  assert.match(i2, /State DROTHER, Priority 1\n  Designated Router \(ID\) 4\.4\.4\.4, Interface address 10\.0\.0\.4\n  Backup Designated router \(ID\) 3\.3\.3\.3/);
  assert.match(i2, /Neighbor Count is 3, Adjacent neighbor count is 2/);
  assert.match(exec(R1, "show ip ospf interface brief"), /Gi0\/0\s+1\s+0\s+10\.0\.0\.1\/24\s+1\s+DROTH 2\/3/);
  // the column layout IOS 15 prints: the priority right-aligned under Pri
  const lines = n1.split("\n");
  assert.equal(lines[0], "Neighbor ID     Pri   State           Dead Time   Address         Interface");
  assert.match(lines[3], /^4\.4\.4\.4          50   FULL\/DR         \d\d:\d\d:\d\d    10\.0\.0\.4        GigabitEthernet0\/0$/);
  const brief = exec(R1, "show ip ospf interface brief").split("\n");
  assert.equal(brief[0], "Interface    PID   Area            IP Address/Mask    Cost  State Nbrs F/C");
  assert.equal(brief[1], "Gi0/0        1     0               10.0.0.1/24        1     DROTH 2/3");
});

test("BPDU Guard err-disables a port that hears a switch, with the reason", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [S("SW1", 20, 20), S("SW2", 70, 20)], links: [["SW1", "fa0/1", "SW2", "fa0/1"]] });
  const sw1 = l.devices.SW1;
  exec(sw1, "enable");
  exec(sw1, "configure terminal");
  exec(sw1, "interface fa0/1");
  exec(sw1, "switchport mode access");
  const out = exec(sw1, "spanning-tree bpduguard enable");
  assert.match(out, /%SPANTREE-2-BLOCK_BPDUGUARD: Received BPDU on port Fa0\/1 with BPDU Guard enabled\. Disabling port\./);
  assert.match(out, /%PM-4-ERR_DISABLE: bpduguard error detected on Fa0\/1, putting Fa0\/1 in err-disable state\n%LINEPROTO-5-UPDOWN: Line protocol on Interface FastEthernet0\/1, changed state to down\n%LINK-3-UPDOWN: Interface FastEthernet0\/1, changed state to down/);
  exec(sw1, "end");
  assert.match(exec(sw1, "show interfaces status err-disabled"), /Fa0\/1\s+err-disabled bpduguard/);
  // shut / no shut brings it back, and the BPDU takes it down again
  for (const c of ["configure terminal", "interface fa0/1", "shutdown"]) exec(sw1, c);
  assert.match(exec(sw1, "no shutdown"), /bpduguard error detected/);
});

test("a Layer 3 switch needs ip routing before router ospf", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { L3 } = await import("../labs/kit.js");
  const d = buildLab({ id: "t", tasks: [], solution: {}, devices: [L3("DSW1", 50, 30)] }).devices.DSW1;
  for (const c of ["enable", "configure terminal"]) exec(d, c);
  assert.match(exec(d, "router ospf 1"), /% IP routing not enabled/);
  exec(d, "ip routing");
  assert.doesNotMatch(exec(d, "router ospf 1"), /%/);
});

test("LLDP: a port that only listens still learns its neighbor, and the detail is IOS's", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, R } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 20, 20), S("SW1", 70, 20)], links: [["R1", "g0/0", "SW1", "g0/1"]] });
  const { R1, SW1 } = l.devices;
  for (const d of [R1, SW1]) for (const c of ["enable", "configure terminal", "lldp run"]) exec(d, c);
  for (const c of ["interface g0/1", "no lldp transmit", "end"]) exec(SW1, c);
  for (const c of ["interface g0/0", "ip address 10.0.0.1 255.255.255.0", "no shutdown", "end"]) exec(R1, c);
  assert.match(exec(SW1, "show lldp neighbors"), /R1\s+Gi0\/1\s+120\s+R\s+Gi0\/0/);
  assert.match(exec(R1, "show lldp neighbors"), /Total entries displayed: 0/);
  const d = exec(SW1, "show lldp neighbors detail");
  assert.match(d, /Local Intf: Gi0\/1\nChassis id: [0-9a-f.]+\nPort id: Gi0\/0\nPort Description: GigabitEthernet0\/0\nSystem Name: R1/);
  assert.match(d, /System Capabilities: B,R\nEnabled Capabilities: R/);
  assert.match(exec(SW1, "show lldp interface g0/1"), /Tx: disabled\n    Rx: enabled/);
});

test("an IP phone learns its voice VLAN from LLDP-MED when CDP is off", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, PHONE } = await import("../labs/kit.js");
  const { phoneVlan } = await import("../engine/host.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [S("SW1", 20, 20), PHONE("IP1", 70, 20, "10.0.20.5/24", "10.0.20.1", { mac: "0011.2233.4455" })], links: [["SW1", "fa0/1", "IP1", "fa0/1"]] });
  const { SW1, IP1 } = l.devices;
  for (const c of ["enable", "configure terminal", "interface fa0/1", "switchport mode access", "switchport access vlan 10", "switchport voice vlan 20", "exit"]) exec(SW1, c);
  assert.equal(phoneVlan(IP1), 20);
  exec(SW1, "no cdp run");
  assert.equal(phoneVlan(IP1), null);
  exec(SW1, "lldp run");
  assert.equal(phoneVlan(IP1), 20);
  exec(SW1, "end");
  assert.match(exec(SW1, "show lldp neighbors"), /SEP001122334455\s+Fa0\/1\s+180\s+B,T\s+001122334455:P1/);
  assert.match(exec(SW1, "show lldp neighbors detail"), /Network Policy\(Voice\): VLAN 20, tagged, Layer-2 priority: 5, DSCP: 46/);
});

test("show ip ospf neighbor: the dead time follows the dead interval, and detail shows the DR and BDR", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "ospf-timers");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const c of lines) exec(l.devices[k.split("#")[0]], c);
  const r1 = l.devices.R1;
  exec(r1, "end");
  const dead = exec(r1, "show ip ospf neighbor").match(/FULL\/\S+\s+(\d\d):(\d\d):(\d\d)/);
  const secs = Number(dead[1]) * 3600 + Number(dead[2]) * 60 + Number(dead[3]);
  assert.ok(secs > 15 && secs < 20, `dead time ${secs}s with hello 5 and dead 20`);
  const d = exec(r1, "show ip ospf neighbor detail");
  assert.match(d, /Neighbor \S+, interface address 10\.0\.12\.2\n    In the area 0 via interface GigabitEthernet0\/1/);
  assert.match(d, /DR is 10\.0\.12\.\d BDR is 10\.0\.12\.\d/);
  assert.match(d, /Dead timer due in 00:00:1\d/);
});

test("switch show commands for one port: trunk (in a bundle too), status, portfast, blocked ports, MAC address", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "ch-bundle-stp");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const c of lines) exec(l.devices[k.split("#")[0]], c);
  const sw = l.devices.DSW1;
  exec(sw, "end");
  assert.match(exec(sw, "show interfaces fa0/23 trunk"), /Fa0\/23\s+on\s+802\.1q\s+trunk-inbndl\s+1 \(Po1\)/);
  assert.match(exec(sw, "show interfaces fa0/5 trunk"), /Fa0\/5\s+auto\s+negotiate\s+not-trunking/);
  assert.match(exec(sw, "show interfaces fa0/23 status"), /^Port[^\n]+\nFa0\/23 [^\n]+trunk/);
  assert.match(exec(sw, "show spanning-tree blockedports"), /Number of blocked ports \(segments\) in the system : \d+/);
  assert.match(exec(sw, "show spanning-tree interface fa0/23 portfast"), /VLAN0010\s+disabled/);
  assert.match(exec(sw, "show vlan summary"), /Number of existing VLANs\s+: \d+/);
  assert.match(exec(sw, "show privilege"), /Current privilege level is 15/);
});

test("show access-lists prints a standard entry's wildcard as wildcard bits; the running config keeps the short form", () => {
  const d = router();
  for (const c of ["configure terminal", "access-list 10 permit 10.1.1.16 0.0.0.15", "access-list 10 permit host 10.2.2.2", "access-list 10 deny any", "end"]) exec(d, c);
  const out = exec(d, "show access-lists");
  assert.match(out, /    10 permit 10\.1\.1\.16, wildcard bits 0\.0\.0\.15\n    20 permit 10\.2\.2\.2\n    30 deny +any/);
  assert.match(exec(d, "show running-config"), /access-list 10 permit 10\.1\.1\.16 0\.0\.0\.15/);
  exec(d, "configure terminal");
  exec(d, "enable secret Cl4ss!c");
  exec(d, "end");
  // md5-crypt: $1$, a 4-character salt, $, a 22-character hash
  assert.match(exec(d, "show running-config"), /enable secret 5 \$1\$[.\/0-9A-Za-z]{4}\$[.\/0-9A-Za-z]{22}\n/);
});

test("show spanning-tree detail and interface detail: the designated bridge per port; show dtp interface", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "ch-bundle-stp");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const c of lines) exec(l.devices[k.split("#")[0]], c);
  const sw = l.devices.DSW2;
  exec(sw, "end");
  const d = exec(sw, "show spanning-tree vlan 10 detail");
  assert.match(d, /^ VLAN0010 is executing the (ieee|rstp) compatible Spanning Tree protocol/);
  assert.match(d, /Port \d+ \(GigabitEthernet0\/1\) of VLAN0010 is alternate blocking/);
  assert.match(exec(sw, "show spanning-tree interface g0/1 detail"), /Designated bridge has priority \d+, address [0-9a-f.]+/);
  assert.match(exec(sw, "show dtp interface fa0/5"), /TOS\/TAS\/TNS:\s+ACCESS\/AUTO\/ACCESS/);
  assert.match(exec(sw, "show spanning-tree inconsistentports"), /Number of inconsistent ports \(segments\) in the system : 0/);
});

test("show ip route <net> <mask> [longer-prefixes] and show protocols", () => {
  const d = router();
  for (const c of ["configure terminal", "interface loopback0", "ip address 10.1.1.1 255.255.255.0", "exit", "ip route 10.2.0.0 255.255.0.0 10.1.1.2", "ip route 10.2.5.0 255.255.255.0 10.1.1.3", "ip route 172.16.0.0 255.255.0.0 10.1.1.2", "end"]) exec(d, c);
  const lp = exec(d, "show ip route 10.2.0.0 255.255.0.0 longer-prefixes");
  assert.match(lp, /S +10\.2\.0\.0\/16 \[1\/0\] via 10\.1\.1\.2/);
  assert.match(lp, /S +10\.2\.5\.0\/24 \[1\/0\] via 10\.1\.1\.3/);
  assert.doesNotMatch(lp, /172\.16|10\.1\.1\.0/);
  assert.match(exec(d, "show ip route 10.2.0.0 255.255.0.0"), /Routing entry for 10\.2\.0\.0\/16/);
  assert.match(exec(d, "show ip route 10.2.0.0 255.255.255.0"), /% Subnet not in table/);
  const p = exec(d, "show protocols");
  assert.match(p, /Internet Protocol routing is enabled/);
  assert.match(p, /Loopback0 is up, line protocol is up\n  Internet address is 10\.1\.1\.1\/24/);
});

test("show ip ospf database router/network/external agree with the summary table", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "ospf-default-originate");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const c of lines) exec(l.devices[k.split("#")[0]], c);
  const r1 = l.devices.R1;
  exec(r1, "end");
  const table = exec(r1, "show ip ospf database");
  const rtr = exec(r1, "show ip ospf database router");
  // every router LSA in the table appears in the detail with the same link count
  for (const [, id, count] of table.matchAll(/^(\d+\.\d+\.\d+\.\d+)\s+\S+\s+\d+\s+0x80000004 0x\S+ (\d+)$/gm)) {
    assert.match(rtr, new RegExp(`Link State ID: ${id.replace(/\./g, "\\.")}[\\s\\S]*?Number of Links: ${count}`));
  }
  assert.match(rtr, /Link connected to: a Transit Network\n     \(Link ID\) Designated Router address: 10\.0\.12\.1/);
  assert.match(exec(r1, "show ip ospf database network"), /Link State ID: 10\.0\.12\.1 \(address of Designated Router\)[\s\S]*Attached Router: 203\.0\.113\.2\n        Attached Router: 10\.0\.12\.2/);
  assert.match(exec(r1, "show ip ospf database external"), /Link State ID: 0\.0\.0\.0 \(External Network Number \)[\s\S]*Metric Type: 2/);
});

test("PC routing tables and settings: route print, getmac, route -n, netstat -rn, host, networksetup -getinfo, route get default", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, HOST } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [S("SW1", 50, 20), HOST("W", 20, 60, "windows", { ip: "10.1.1.21/24", gateway: "10.1.1.1", mac: "0050.7966.0021" }), HOST("L", 50, 60, "linux", { ip: "10.1.1.22/24", gateway: "10.1.1.1", mac: "0050.7966.0022" }), HOST("M", 80, 60, "mac", { ip: "10.1.1.23/24", gateway: "10.1.1.1", mac: "0050.7966.0023" })], links: [["SW1", "fa0/1", "W", "fa0"], ["SW1", "fa0/2", "L", "fa0"], ["SW1", "fa0/3", "M", "fa0"]] });
  const { W, L, M } = l.devices;
  assert.match(exec(W, "route print"), /\n {10}0\.0\.0\.0 {10}0\.0\.0\.0 {9}10\.1\.1\.1 {8}10\.1\.1\.21 {5}25\n/);
  assert.match(exec(W, "route print"), / {9}10\.1\.1\.0 {4}255\.255\.255\.0 {10}On-link {8}10\.1\.1\.21 {4}281/);
  assert.equal(exec(W, "netstat -r"), exec(W, "route print"));
  assert.match(exec(W, "getmac"), /00-50-79-66-00-21 +\\Device\\Tcpip_/);
  assert.match(exec(L, "route -n"), /0\.0\.0\.0 +10\.1\.1\.1 +0\.0\.0\.0 +UG +100/);
  assert.match(exec(L, "netstat -rn"), /10\.1\.1\.0 +0\.0\.0\.0 +255\.255\.255\.0 +U +0 0 +0 eth0/);
  assert.match(exec(M, "networksetup -getinfo Ethernet"), /Manual Configuration\nIP address: 10\.1\.1\.23\nSubnet mask: 255\.255\.255\.0\nRouter: 10\.1\.1\.1/);
  assert.match(exec(M, "route get default"), /gateway: 10\.1\.1\.1\n  interface: en0/);
  assert.equal(exec(M, "ipconfig getifaddr en0"), "10.1.1.23");
  assert.match(exec(L, "host example.com"), /no servers could be reached|not found|has address/);
});

test("show etherchannel detail and show ip route summary", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "ch-bundle-stp");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const c of lines) exec(l.devices[k.split("#")[0]], c);
  const sw = l.devices.DSW1;
  exec(sw, "end");
  const d = exec(sw, "show etherchannel detail");
  assert.match(d, /Group: 1\n----------\nGroup state = L2/);
  assert.match(d, /Port: Fa0\/23\n------------\n\nPort state    = Up Mstr Assoc In-Bndl/);
  assert.match(d, /Port-channel: Po1/);
  const r = router();
  for (const c of ["configure terminal", "interface loopback0", "ip address 10.1.1.1 255.255.255.0", "exit", "ip route 0.0.0.0 0.0.0.0 10.1.1.254", "end"]) exec(r, c);
  const sum = exec(r, "show ip route summary");
  assert.match(sum, /connected +0 +2 +0 +192 +608/);
  assert.match(sum, /static +1 +0 +0 +96 +304/);
});

test("bandwidth follows the negotiated speed, and OSPF costs follow the bandwidth; serial is point-to-point", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, S } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 20, 20), R("R3", 60, 60), S("SW1", 20, 60)], links: [["R1", "s0/0/0", "R3", "s0/0/0"], ["R1", "g0/1", "SW1", "fa0/1"]] });
  const r1 = l.devices.R1;
  for (const c of ["enable", "configure terminal", "interface s0/0/0", "ip address 10.0.13.1 255.255.255.252", "clock rate 128000", "no shutdown", "interface g0/1", "ip address 10.1.1.1 255.255.255.0", "no shutdown", "router ospf 1", "network 10.0.0.0 0.255.255.255 area 0", "auto-cost reference-bandwidth 10000", "end"]) exec(r1, c);
  assert.match(exec(r1, "show interfaces g0/1"), /BW 100000 Kbit\/sec/);
  const brief = exec(r1, "show ip ospf interface brief");
  assert.match(brief, /Gi0\/1 +1 +0 +10\.1\.1\.1\/24 +100 /);
  assert.match(brief, /Se0\/0\/0 +1 +0 +10\.0\.13\.1\/30 +6476 +P2P/);
});

test("port security counts an IP phone and the PC behind it: maximum 1 shuts the port, maximum 2 lets both through", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, HOST, PHONE } = await import("../labs/kit.js");
  const build = () => buildLab({ id: "t", tasks: [], solution: {}, devices: [S("SW1", 50, 20), PHONE("IP1", 20, 40, "10.1.1.50/24", "10.1.1.1", { mac: "0011.2233.4455" }), HOST("PC1", 20, 60, "windows", { ip: "10.1.1.21/24", gateway: "10.1.1.1", mac: "0050.7966.0021" }), HOST("PC2", 80, 60, "windows", { ip: "10.1.1.22/24", gateway: "10.1.1.1", mac: "0050.7966.0022" })], links: [["SW1", "fa0/1", "IP1", "fa0/1"], ["IP1", "fa0/2", "PC1", "fa0"], ["SW1", "fa0/2", "PC2", "fa0"]] });
  for (const [max, down] of [[1, true], [2, false]]) {
    const l = build();
    const sw = l.devices.SW1;
    for (const c of ["enable", "configure terminal", "interface fa0/1", "switchport mode access", "switchport port-security", `switchport port-security maximum ${max}`, "end"]) exec(sw, c);
    const ping = exec(l.devices.PC1, "ping 10.1.1.22");
    const ps = exec(sw, "show port-security interface fa0/1");
    if (down) {
      assert.match(ps, /Port Status +: Secure-shutdown/);
      assert.match(ps, /Last Source Address:Vlan +: 0050\.7966\.0021:1\nSecurity Violation Count +: 1/);
      assert.match(ping, /Destination host unreachable/);
    } else {
      assert.match(ps, /Total MAC Addresses +: 2/);
      assert.match(ping, /Received = [34]/);
    }
  }
});

test("port security protect drops without counting; restrict counts and logs", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, HOST, PHONE } = await import("../labs/kit.js");
  for (const [mode, count] of [["protect", 0], ["restrict", 1]]) {
    const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [S("SW1", 50, 20), PHONE("IP1", 20, 40, "10.1.1.50/24", "10.1.1.1", { mac: "0011.2233.4455" }), HOST("PC1", 20, 60, "windows", { ip: "10.1.1.21/24", gateway: "10.1.1.1", mac: "0050.7966.0021" }), HOST("PC2", 80, 60, "windows", { ip: "10.1.1.22/24", gateway: "10.1.1.1", mac: "0050.7966.0022" })], links: [["SW1", "fa0/1", "IP1", "fa0/1"], ["IP1", "fa0/2", "PC1", "fa0"], ["SW1", "fa0/2", "PC2", "fa0"]] });
    const sw = l.devices.SW1;
    for (const c of ["enable", "configure terminal", "interface fa0/1", "switchport mode access", "switchport port-security", `switchport port-security violation ${mode}`, "end"]) exec(sw, c);
    exec(l.devices.PC1, "ping 10.1.1.22");
    assert.match(exec(sw, "show port-security interface fa0/1"), new RegExp(`Port Status +: Secure-up[\\s\\S]*Security Violation Count +: ${count}`));
  }
});

test("show ipv6 route lists prefixes in order (::/0 first, FF00::/8 last) and filters static", () => {
  const d = router();
  for (const c of ["configure terminal", "ipv6 unicast-routing", "interface loopback0", "ipv6 address 2001:db8:1::1/64", "exit", "ipv6 route 2001:db8:3::/64 2001:db8:1::2", "ipv6 route ::/0 2001:db8:1::2 200", "end"]) exec(d, c);
  const all = exec(d, "show ipv6 route");
  const codes = [...all.matchAll(/^(\S+) +(\S+) \[/gm)].map((m) => m[2]);
  assert.deepEqual(codes, ["::/0", "2001:DB8:1::/64", "2001:DB8:1::1/128", "2001:DB8:3::/64", "FF00::/8"]);
  const st = exec(d, "show ipv6 route static");
  assert.match(st, /S   ::\/0 \[200\/0\][\s\S]*S   2001:DB8:3::\/64 \[1\/0\]/);
  assert.doesNotMatch(st, /^[CL] /m);
});

test("a standard ACL's action is padded to six characters in show access-lists and the running config", () => {
  const r = router();
  for (const c of ["configure terminal", "access-list 10 deny 10.3.3.0 0.0.0.255", "access-list 10 deny host 10.9.9.9", "access-list 10 permit any", "end"]) exec(r, c);
  const show = exec(r, "show access-lists 10");
  assert.match(show, /\n {4}10 deny {3}10\.3\.3\.0, wildcard bits 0\.0\.0\.255\n {4}20 deny {3}10\.9\.9\.9\n {4}30 permit any/);
  const run = exec(r, "show running-config");
  assert.match(run, /access-list 10 deny {3}10\.3\.3\.0 0\.0\.0\.255\naccess-list 10 deny {3}10\.9\.9\.9\naccess-list 10 permit any/);
  // in named mode, no with an entry's text removes only that entry
  for (const c of ["configure terminal", "ip access-list standard 10", "no deny host 10.9.9.9", "end"]) exec(r, c);
  assert.match(exec(r, "show access-lists 10"), /10 deny {3}10\.3\.3\.0, wildcard bits 0\.0\.0\.255\n {4}30 permit any$/);
  // in global config, no access-list with any entry's text deletes the whole numbered list
  for (const c of ["configure terminal", "no access-list 10 deny 10.3.3.0 0.0.0.255", "end"]) assert.doesNotMatch(exec(r, c), /Invalid/);
  assert.equal(exec(r, "show access-lists"), "");
});

test("a 2960 lists its FastEthernet ports before the gigabit uplinks, and a trunking port-channel shows once", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "ch-bundle-stp");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const c of lines) exec(l.devices[k.split("#")[0]], c);
  const sw = l.devices.DSW1;
  exec(sw, "end");
  const st = exec(sw, "show interfaces status").split("\n").map((x) => x.split(" ")[0]);
  assert.ok(st.indexOf("Fa0/24") < st.indexOf("Gi0/1") && st.indexOf("Gi0/2") < st.indexOf("Po1"), st.join(","));
  const tr = exec(sw, "show interfaces trunk");
  assert.equal(tr.match(/^Po1 /gm).length, 4);
  assert.ok(tr.indexOf("Gi0/1") < tr.indexOf("Po1"));
});

test("show ip ospf counts the LSAs the database shows and names an ASBR", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "sim-ospf");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const c of lines) exec(l.devices[k.split("#")[0]], c);
  const r1 = l.devices.R1;
  exec(r1, "end");
  const db = exec(r1, "show ip ospf database");
  const lsas = db.split("\n").filter((x) => /^\d+\.\d+\.\d+\.\d+ /.test(x)).length;
  const p = exec(r1, "show ip ospf");
  assert.match(p, new RegExp(`Number of LSA ${lsas}\\. Checksum Sum 0x[0-9A-F]{6}`));
  assert.match(p, /Number of interfaces in this area is 3 \(1 loopback\)/);
  assert.match(p, /Reference bandwidth unit is 100 mbps/);
  assert.doesNotMatch(p, /autonomous system boundary/);
  for (const c of ["configure terminal", "ip route 0.0.0.0 0.0.0.0 Null0", "router ospf 10", "default-information originate", "end"]) exec(r1, c);
  const q = exec(r1, "show ip ospf");
  assert.match(q, /It is an autonomous system boundary router/);
  assert.match(q, /Number of external LSA 1\./);
});

test("show standby as ios 15 prints it: the virtual mac in use only on the active router, peers with priority and expiry", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "sim-hsrp");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const c of lines) exec(l.devices[k.split("#")[0]], c);
  const r1 = l.devices.R1;
  exec(r1, "end");
  const out = exec(r1, "show standby");
  assert.match(out, /State is Active\n {4}2 state changes/);
  assert.match(out, /Active virtual MAC address is 0000\.0c07\.ac0a \(MAC In Use\)\n {4}Local virtual MAC address is 0000\.0c07\.ac0a \(v1 default\)/);
  assert.match(out, /Standby router is 10\.10\.10\.3, priority 100 \(expires in [\d.]+ sec\)/);
  assert.match(out, /State is Standby[\s\S]*\(MAC Not In Use\)[\s\S]*Active router is 10\.10\.20\.3, priority \d+ \(expires/);
});

test("show version per model, and a changed configuration register shows what it will be at the next reload", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const l = buildLab(LABS.find((x) => x.id === "config-register"));
  const r = l.devices.R1;
  assert.match(exec(r, "show version"), /Configuration register is 0x2142$/);
  for (const c of ["enable", "configure terminal", "config-register 0x2102", "end"]) exec(r, c);
  const v = exec(r, "show version");
  assert.match(v, /C2900 Software \(C2900-UNIVERSALK9-M\), Version 15\.1\(4\)M4/);
  assert.match(v, /\d+ Gigabit Ethernet interfaces/);
  assert.match(v, /Configuration register is 0x2142 \(will be 0x2102 at next reload\)$/);
  exec(r, "reload");
  exec(r, "no");
  exec(r, "");
  exec(r, "");
  exec(r, "enable");
  assert.match(exec(r, "show version"), /Configuration register is 0x2102$/);
  const sw = createDevice({ name: "SW1", type: "switch", hostname: "SW1" });
  exec(sw, "enable");
  const s = exec(sw, "show version");
  assert.match(s, /C2960 Software \(C2960-LANBASEK9-M\), Version 15\.0\(2\)SE4/);
  assert.match(s, /24 FastEthernet interfaces\n2 Gigabit Ethernet interfaces/);
  assert.match(s, /Configuration register is 0xF$/);
});
test("with 0x2142 a reload ignores the startup-config (password recovery)", () => {
  const r = router();
  for (const c of ["configure terminal", "hostname EDGE", "end", "copy running-config startup-config", "", "configure terminal", "config-register 0x2142", "end"]) exec(r, c);
  exec(r, "reload");
  exec(r, "no");
  const out = exec(r, "");
  assert.match(out, /System Configuration Dialog/);
  assert.notEqual(r.hostname, "EDGE");
  assert.ok(r.saved);
});

test("show ip protocols starts with the nsf line and lists interfaces put in ospf explicitly", () => {
  const r = router();
  assert.equal(exec(r, "show ip protocols"), "*** IP Routing is NSF aware ***");
  for (const c of ["configure terminal", "interface loopback0", "ip address 1.1.1.1 255.255.255.255", "ip ospf 1 area 0", "interface g0/0", "ip address 10.0.12.1 255.255.255.252", "no shutdown", "ip ospf 1 area 0", "router ospf 1", "passive-interface loopback0", "end"]) exec(r, c);
  const out = exec(r, "show ip protocols");
  assert.match(out, /^\*\*\* IP Routing is NSF aware \*\*\*\n\nRouting Protocol is "ospf 1"/);
  assert.match(out, /Routing for Networks:\n  Routing on Interfaces Configured Explicitly \(Area 0\):\n    GigabitEthernet0\/0\n    Loopback0\n  Passive Interface\(s\):\n    Loopback0/);
});

test("copy startup-config running-config merges: interfaces shut in the running config stay shut", () => {
  const r = router();
  for (const c of ["configure terminal", "hostname EDGE", "interface g0/0", "ip address 10.0.0.1 255.255.255.0", "no shutdown", "end", "copy running-config startup-config", "", "configure terminal", "config-register 0x2142", "end", "reload", "no", ""]) exec(r, c);
  assert.equal(r.interfaces["GigabitEthernet0/0"].ip, null);
  for (const c of ["enable", "copy startup-config running-config", ""]) exec(r, c);
  assert.equal(r.hostname, "EDGE");
  assert.equal(r.interfaces["GigabitEthernet0/0"].ip, "10.0.0.1");
  assert.equal(r.interfaces["GigabitEthernet0/0"].shutdown, true);
  assert.match(exec(r, "show ip interface brief"), /GigabitEthernet0\/0 +10\.0\.0\.1 +YES \w+ +administratively down down/);
});

test("ping alone runs the extended ping dialog, and a sourced extended ping counts as ping ... source", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "extended-ping");
  const l = buildLab(def);
  const r1 = l.devices.R1;
  exec(r1, "enable");
  assert.equal(exec(r1, "ping"), "");
  assert.equal(prompt(r1), "Protocol [ip]: ");
  const answers = ["", "10.3.3.1", "3", "1500", "", "y", "g0/0", "", "", "", "", "", ""];
  let out = "";
  for (const a of answers) out = exec(r1, a);
  assert.match(out, /Sending 3, 1500-byte ICMP Echos to 10\.3\.3\.1, timeout is 2 seconds:\nPacket sent with a source address of 10\.1\.1\.1/);
  assert.equal(prompt(r1), "R1#");
  assert.ok(r1.ran.some((x) => x.text === "ping 10.3.3.1 source GigabitEthernet0/0 repeat 3"));
  exec(r1, "ping");
  for (const a of ["", "10.3.3.1", "", "", "", "y"]) exec(r1, a);
  assert.match(exec(r1, "10.99.99.99"), /% Invalid source/);
  assert.equal(prompt(r1), "R1#");
  exec(r1, "ping");
  assert.match(exec(r1, "ipx"), /% Unknown protocol - "ipx"/);
  exec(r1, "ping");
  exec(r1, "");
  assert.equal(exec(r1, ""), "% Bad IP address");
  exec(r1, "ping");
  for (const a of ["", "10.3.3.1", "", "", "", "", ""]) out = exec(r1, a);
  assert.match(out, /Sending 5, 100-byte ICMP Echos to 10\.3\.3\.1, timeout is 2 seconds:\n[.!U]{5}/);
  const task = def.tasks[0];
  const t2 = buildLab(def);
  exec(t2.devices.R1, "enable");
  exec(t2.devices.R1, "ping");
  for (const a of ["", "10.3.3.1", "", "", "", "y", "g0/0", "", "", "", "", "", ""]) exec(t2.devices.R1, a);
  assert.ok(t2.devices.R1.ran.some((x) => /^ping 10\.3\.3\.1 source (GigabitEthernet0\/0|10\.1\.1\.1)$/.test(x.text)), "the lab task's pattern accepts it");
  assert.ok(task);
});

test("pc terminals answer like the real os: ping stopped with ^C, interactive nslookup, netstat sockets, route get <address>", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, S, HOST } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 20, 20, ["enable", "configure terminal", "interface g0/0", "ip address 10.1.1.1 255.255.255.0", "no shutdown", "end"]), S("SW1", 50, 20), HOST("L", 20, 60, "linux", { ip: "10.1.1.2/24", gateway: "10.1.1.1" }), HOST("W", 40, 60, "windows", { ip: "10.1.1.3/24", gateway: "10.1.1.1" }), HOST("M", 60, 60, "mac", { ip: "10.1.1.4/24", gateway: "10.1.1.1" })], links: [["R1", "g0/0", "SW1", "g0/1"], ["SW1", "fa0/1", "L", "fa0"], ["SW1", "fa0/2", "W", "fa0"], ["SW1", "fa0/3", "M", "fa0"]] });
  const { L, W, M } = l.devices;
  for (const [d, re] of [[L, /icmp_seq=4[^\n]*\n\^C\n--- 10\.1\.1\.1 ping statistics ---/], [M, /icmp_seq=3[^\n]*\n\^C\n--- 10\.1\.1\.1 ping statistics ---/]]) {
    const out = exec(d, "ping 10.1.1.1");
    assert.match(out, re);
    assert.doesNotMatch(out, /simulated|stopped after/);
  }
  assert.doesNotMatch(exec(L, "ping -c 2 10.1.1.1"), /\^C/);
  assert.equal(exec(L, "nslookup"), "");
  assert.equal(prompt(L), "> ");
  assert.match(exec(L, "server 10.1.1.1"), /Default server: 10\.1\.1\.1/);
  exec(L, "exit");
  assert.match(prompt(L), /\$ $/);
  assert.match(exec(W, "nslookup"), /^Default Server:/);
  assert.equal(prompt(W), "> ");
  exec(W, "exit");
  assert.match(exec(L, "netstat -tulpn"), /Active Internet connections \(only servers\)\nProto Recv-Q Send-Q Local Address +Foreign Address +State +PID\/Program name\ntcp +0 +0 127\.0\.0\.53:53 +0\.0\.0\.0:\* +LISTEN/);
  assert.match(exec(M, "netstat -an"), /Active Internet connections \(including servers\)/);
  assert.match(exec(M, "route get 10.1.1.9"), /destination: 10\.1\.1\.0\n +mask: 255\.255\.255\.0/);
  assert.match(exec(M, "route get 8.8.8.8"), /route to: 8\.8\.8\.8\ndestination: default\n +mask: default\n +gateway: 10\.1\.1\.1/);
});

test("telnet and ssh log in for real: the password is checked, commands run on the remote device, exit closes the session", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const l = buildLab(LABS.find((x) => x.id === "telnet-vs-ssh"));
  const { R1, R2 } = l.devices;
  exec(R1, "enable");
  assert.match(exec(R1, "telnet 10.0.12.2"), /Trying 10\.0\.12\.2 \.\.\. Open\n\n\nUser Access Verification\n\n$/);
  assert.equal(prompt(R1), "Password: ");
  exec(R1, "wrong");
  assert.equal(prompt(R1), "Password: ");
  exec(R1, "Vty0ld");
  assert.equal(prompt(R1), "R2>");
  assert.equal(exec(R1, "enable"), "% No password set");
  assert.match(exec(R1, "show users"), /\*  2 vty 0 +idle +00:00:00 10\.0\.12\.1/);
  assert.equal(prompt(R2), "R2>");
  assert.match(exec(R1, "exit"), /\[Connection to 10\.0\.12\.2 closed by foreign host\]/);
  assert.equal(prompt(R1), "R1#");
  for (const c of ["enable", "configure terminal", "enable secret Cl4ss", "username boss privilege 15 secret B0ss", "line vty 0 4", "transport input ssh", "login local", "end"]) exec(R2, c);
  assert.match(exec(R1, "telnet 10.0.12.2"), /% Connection refused by remote host/);
  exec(R1, "ssh -l admin 10.0.12.2");
  exec(R1, "Adm1nPass");
  assert.equal(prompt(R1), "R2>");
  exec(R1, "enable");
  assert.equal(prompt(R1), "Password: ");
  exec(R1, "Cl4ss");
  for (const c of ["configure terminal", "interface loopback0", "ip address 2.2.2.2 255.255.255.255", "end"]) exec(R1, c);
  assert.equal(R2.interfaces.Loopback0.ip, "2.2.2.2");
  exec(R1, "exit");
  exec(R1, "ssh -l boss 10.0.12.2");
  exec(R1, "B0ss");
  assert.equal(prompt(R1), "R2#");
  exec(R1, "exit");
  exec(R1, "ssh -l admin 10.0.12.2");
  exec(R1, "x");
  exec(R1, "y");
  assert.equal(exec(R1, "z"), "% Authentication failed.");
  assert.equal(prompt(R1), "R1#");
});

test("setup runs the system configuration dialog and saves what it builds", () => {
  const r = router();
  assert.match(exec(r, "setup"), /--- System Configuration Dialog ---/);
  assert.equal(prompt(r), "Continue with configuration dialog? [yes/no]: ");
  const answers = ["yes", "yes", "EDGE", "Cl4ss", "Cl4ss", "Pw0rd", "Vty1", "", "g0/0", "yes", "10.1.1.1", "255.255.255.0"];
  let out = "";
  for (const a of answers) out = exec(r, a);
  assert.match(out, /Class A network is 10\.0\.0\.0, 16 subnet bits; mask is \/24/);
  assert.match(out, /The following configuration command script was created:\n\nhostname EDGE\nenable secret 5 \$1\$/);
  assert.match(out, /interface GigabitEthernet0\/0\nno shutdown\nip address 10\.1\.1\.1 255\.255\.255\.0/);
  assert.equal(prompt(r), "Enter your selection [2]: ");
  assert.match(exec(r, ""), /Building configuration\.\.\.\n\[OK\]/);
  assert.equal(r.hostname, "EDGE");
  assert.equal(r.interfaces["GigabitEthernet0/0"].ip, "10.1.1.1");
  assert.equal(r.lines.vty.password, "Vty1");
  assert.ok(r.saved && r.saved.hostname === "EDGE");
  assert.equal(prompt(r), "EDGE#");
  const r2 = router();
  exec(r2, "setup");
  exec(r2, "no");
  assert.equal(prompt(r2), "R1#");
});

test("macos ipconfig set en0 DHCP asks for a lease without a word", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.devices.some((d) => d.os === "mac") && l.devices.some((d) => (d.setup ?? []).some((c) => /ip dhcp pool/.test(c))));
  if (!def) return;
  const l = buildLab(def);
  const mac = Object.values(l.devices).find((d) => d.host?.os === "mac");
  assert.equal(exec(mac, "sudo ipconfig set en0 DHCP"), "");
  assert.doesNotMatch(exec(mac, "ifconfig en0"), /needs a managed lab/);
});

test("dig with no name asks for the root servers and the lab server fails it, as a real resolver without recursion does", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => (l.solution && Object.values(l.solution).flat().some((c) => /^dig /.test(c))));
  if (!def) return;
  const l = buildLab(def);
  const host = Object.values(l.devices).find((d) => d.host?.os === "linux");
  const out = exec(host, "dig");
  assert.doesNotMatch(out, /\(dig with no name/);
  assert.match(out, /^\n; <<>> DiG 9\.18\.39-0ubuntu0\.24\.04\.9-Ubuntu <<>>\n;; global options: \+cmd\n/);
});

test("show interfaces port-channel lists its members and their counters; dly follows the interface type", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "ch-bundle-stp");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const c of lines) exec(l.devices[k.split("#")[0]], c);
  const sw = l.devices.DSW1;
  exec(sw, "end");
  const po = exec(sw, "show interfaces port-channel 1");
  assert.match(po, /BW 200000 Kbit\/sec, DLY 100 usec/);
  assert.match(po, /Full-duplex, 100Mb\/s, link type is auto, media type is unknown/);
  assert.match(po, /Members in this channel: Fa0\/23 Fa0\/24/);
  assert.match(po, /Output queue: 0\/40/);
  assert.match(exec(sw, "show interfaces fa0/1"), /DLY 100 usec/);
  assert.match(exec(sw, "show interfaces g0/1"), /DLY 10 usec/);
  const r = router();
  for (const c of ["configure terminal", "interface loopback0", "ip address 1.1.1.1 255.255.255.255", "end"]) exec(r, c);
  assert.match(exec(r, "show interfaces loopback0"), /MTU 1514 bytes, BW 8000000 Kbit\/sec, DLY 5000 usec,[\s\S]*Encapsulation LOOPBACK/);
  assert.match(exec(r, "show interfaces s0/0/0"), /DLY 20000 usec/);
});

test("show interfaces for a loopback, a subinterface and an svi as ios prints them", () => {
  const r = router();
  for (const c of ["configure terminal", "interface loopback0", "ip address 1.1.1.1 255.255.255.255", "interface g0/0", "no shutdown", "interface g0/0.10", "encapsulation dot1q 10", "ip address 10.10.10.1 255.255.255.0", "end"]) exec(r, c);
  const lo = exec(r, "show interfaces loopback0");
  assert.match(lo, /^Loopback0 is up, line protocol is up\n  Hardware is Loopback\n  Internet address is 1\.1\.1\.1\/32/);
  assert.match(lo, /Output queue: 0\/0 \(size\/max\)/);
  const sub = exec(r, "show interfaces g0/0.10");
  assert.match(sub, /Encapsulation 802\.1Q Virtual LAN, Vlan ID  10\.\n  ARP type: ARPA/);
  assert.doesNotMatch(sub, /loopback not set/);
  const sw = createDevice({ name: "SW1", type: "switch", hostname: "SW1" });
  for (const c of ["enable", "configure terminal", "interface vlan 1", "ip address 10.1.1.2 255.255.255.0", "no shutdown", "end"]) exec(sw, c);
  assert.match(exec(sw, "show interfaces vlan 1"), /Hardware is EtherSVI[\s\S]*Keepalive not supported[\s\S]*Received 0 broadcasts \(0 IP multicasts\)/);
});

test("pc terminals: ss on ubuntu, command-not-found package hints, whoami, macos ipconfig getpacket", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const l = buildLab(LABS.find((x) => x.id === "sim-three-hosts"));
  const hosts = Object.values(l.devices).filter((d) => d.host);
  const lin = hosts.find((d) => d.host.os === "linux"), win = hosts.find((d) => d.host.os === "windows"), mac = hosts.find((d) => d.host.os === "mac");
  assert.match(exec(lin, "ss -tuln"), /^Netid State +Recv-Q Send-Q Local Address:Port +Peer Address:Port\nudp +UNCONN/);
  assert.match(exec(lin, "nmcli"), /^Command 'nmcli' not found, but can be installed with:\nsudo apt install network-manager$/);
  assert.equal(exec(lin, "whoami"), lin.host.user);
  assert.match(exec(win, "whoami"), /\\/);
  if (mac) assert.doesNotMatch(exec(mac, "ipconfig getpacket en0"), /usage/);
});

test("show standby for one interface and group", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "sim-hsrp");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const c of lines) exec(l.devices[k.split("#")[0]], c);
  const r = l.devices.R2;
  exec(r, "end");
  const one = exec(r, "show standby g0/0.10");
  assert.match(one, /^GigabitEthernet0\/0\.10 - Group 10/);
  assert.doesNotMatch(one, /Group 20/);
  assert.match(exec(r, "show standby g0/0.20 20 brief"), /Gi0\/0\.20 +20 /);
});

test("native vlan mismatch: cdp logs it on both switches once; a blocked trunk forwards no vlans", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [S("SW1", 20, 20), S("SW2", 60, 20)], links: [["SW1", "g0/1", "SW2", "g0/1"]] });
  const { SW1, SW2 } = l.devices;
  for (const c of ["enable", "configure terminal", "vlan 99", "exit", "interface g0/1", "switchport mode trunk"]) exec(SW1, c);
  const out = exec(SW1, "switchport trunk native vlan 99");
  assert.match(out, /%CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on GigabitEthernet0\/1 \(99\), with SW2 GigabitEthernet0\/1 \(1\)\./);
  assert.equal(exec(SW1, "do show logging | include NATIVE").split("\n").length, 1);
  assert.match(exec(SW2, "enable") + exec(SW2, "show logging | include NATIVE"), /on GigabitEthernet0\/1 \(1\), with SW1 GigabitEthernet0\/1 \(99\)/);
  exec(SW1, "no switchport trunk native vlan");
  assert.match(exec(SW1, "switchport trunk native vlan 99"), /NATIVE_VLAN_MISMATCH/);
  const t = buildLab({ id: "t", tasks: [], solution: {}, devices: [S("SW1", 20, 20), S("SW2", 60, 20), S("SW3", 40, 60)], links: [["SW1", "g0/1", "SW2", "g0/1"], ["SW1", "g0/2", "SW3", "g0/1"], ["SW2", "g0/2", "SW3", "g0/2"]] });
  for (const d of Object.values(t.devices)) for (const c of ["enable", "configure terminal", "interface range g0/1 - 2", "switchport mode trunk", "end"]) exec(d, c);
  assert.match(exec(t.devices.SW3, "show interfaces trunk"), /forwarding state and not pruned\nGi0\/1 +1\nGi0\/2 +none$/);
});

test("show cdp neighbors prints like ios 15: Gig/Fas ports, platform cut to nine characters, codes matching the detail, a total", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, R, PHONE, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [S("SW1", 1, 1), R("R1", 2, 2, cfg("interface g0/0", "no shutdown")), PHONE("P", 3, 3, null, null, { mac: "0011.2233.4455" }), S("A-VERY-LONG-SWITCH-NAME", 4, 4)], links: [["SW1", "g0/1", "R1", "g0/0"], ["SW1", "fa0/5", "P", "fa0/1"], ["SW1", "fa0/24", "A-VERY-LONG-SWITCH-NAME", "fa0/24"]] });
  const sw = l.devices.SW1;
  exec(sw, "enable");
  const out = exec(sw, "show cdp neighbors");
  assert.match(out, /\nR1 +Gig 0\/1 +\d+ +R S I CISCO2911 Gig 0\/0\n/);
  assert.match(out, /\nSEP001122334455 +Fas 0\/5 +\d+ +H P IP Phone +Port 1\n/);
  assert.match(out, /\nA-VERY-LONG-SWITCH-NAME\n {17}Fas 0\/24 +\d+ +S I WS-C2960- Fas 0\/24\n/);
  assert.match(out, /\n\nTotal cdp entries displayed : 3$/);
  assert.match(exec(sw, "show cdp neighbors detail"), /Platform: Cisco CISCO2911\/K9,  Capabilities: Router Switch IGMP/);
});

test("a transit switch without the vlan in its database drops it", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, HOST, cfg } = await import("../labs/kit.js");
  const tr = ["interface g0/1", "switchport mode trunk", "interface g0/2", "switchport mode trunk"];
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [S("SW1", 1, 1, cfg("vlan 30", ...tr, "interface fa0/1", "switchport access vlan 30")), S("SW2", 2, 2, cfg(...tr)), S("SW3", 3, 3, cfg("vlan 30", ...tr, "interface fa0/1", "switchport access vlan 30")), HOST("PC1", 1, 1, "windows", { ip: "10.0.30.1/24" }), HOST("PC3", 1, 1, "linux", { ip: "10.0.30.3/24" })], links: [["SW1", "g0/2", "SW2", "g0/1"], ["SW2", "g0/2", "SW3", "g0/1"], ["SW1", "fa0/1", "PC1", "fa0"], ["SW3", "fa0/1", "PC3", "fa0"]] });
  assert.match(exec(l.devices.PC1, "ping 10.0.30.3"), /Destination host unreachable/);
  for (const c of ["enable", "configure terminal", "vlan 30", "end"]) exec(l.devices.SW2, c);
  assert.match(exec(l.devices.PC1, "ping 10.0.30.3"), /Received = 4/);
});

test("an access port whose vlan was deleted shows inactive and drops the host's frames", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [S("SW1", 1, 1, cfg("vlan 30", "interface range fa0/1 - 2", "switchport mode access", "switchport access vlan 30")), HOST("PC1", 1, 1, "windows", { ip: "10.0.30.1/24" }), HOST("PC2", 1, 1, "linux", { ip: "10.0.30.2/24" })], links: [["SW1", "fa0/1", "PC1", "fa0"], ["SW1", "fa0/2", "PC2", "fa0"]] });
  const s = l.devices.SW1;
  assert.match(exec(l.devices.PC1, "ping 10.0.30.2"), /Received = 4/);
  for (const c of ["enable", "configure terminal", "no vlan 30", "end"]) exec(s, c);
  assert.match(exec(s, "show interfaces status"), /\nFa0\/1 +inactive +30 +a-full +a-100 /);
  assert.match(exec(l.devices.PC1, "ping 10.0.30.2"), /Destination host unreachable/);
});

test("show spanning-tree vlan for a vlan with no instance prints what ios prints", () => {
  const s = createDevice("switch", "SW1");
  for (const c of ["enable", "configure terminal", "vlan 10", "end"]) exec(s, c);
  assert.equal(exec(s, "show spanning-tree vlan 30"), "Spanning tree instance(s) for vlan 30 does not exist.");
  assert.equal(exec(s, "show spanning-tree vlan 10"), "Spanning tree instance(s) for vlan 10 does not exist.");
  assert.equal(exec(s, "show spanning-tree vlan 10 detail"), "Spanning tree instance(s) for vlan 10 does not exist.");
});

test("secure macs sit in the mac table as static; show interfaces <port> counters", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [S("SW1", 1, 1, cfg("vlan 10", "interface range fa0/1 - 2", "switchport mode access", "switchport access vlan 10", "interface fa0/1", "switchport port-security")), HOST("PC1", 1, 1, "windows", { ip: "10.0.10.1/24", mac: "0050.7966.1001" }), HOST("PC2", 1, 1, "windows", { ip: "10.0.10.2/24", mac: "0050.7966.1002" })], links: [["SW1", "fa0/1", "PC1", "fa0"], ["SW1", "fa0/2", "PC2", "fa0"]] });
  exec(l.devices.PC1, "ping 10.0.10.2");
  const s = l.devices.SW1;
  exec(s, "enable");
  assert.match(exec(s, "show mac address-table"), / {2}10 {4}0050\.7966\.1001 {4}STATIC {6}Fa0\/1\n {2}10 {4}0050\.7966\.1002 {4}DYNAMIC {5}Fa0\/2/);
  assert.match(exec(s, "show mac address-table count"), /Mac Entries for Vlan 10:\n-+\nDynamic Address Count  : 1\nStatic  Address Count  : 1/);
  const c = exec(s, "show interfaces fa0/1 counters");
  assert.match(c, /^Port +InOctets/);
  assert.doesNotMatch(c, /Fa0\/2/);
});

test("show ipv6 interface prints the ios 15 detail: link-local, globals with flags, solicited-node groups, nd", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, cfg } = await import("../labs/kit.js");
  const r = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 1, 1), R("R2", 2, 2, cfg("interface g0/0", "no shutdown"))], links: [["R1", "g0/0", "R2", "g0/0"]] }).devices.R1;
  for (const c of ["enable", "configure terminal", "ipv6 unicast-routing", "interface g0/0", "ipv6 address fe80::1 link-local", "ipv6 address 2001:db8:acad:1::1/64", "end"]) exec(r, c);
  const down = exec(r, "show ipv6 interface g0/0");
  assert.match(down, /^GigabitEthernet0\/0 is administratively down, line protocol is down\n  IPv6 is tentative, link-local address is FE80::1 \[TEN\]/);
  exec(r, "configure terminal"); exec(r, "interface g0/0"); exec(r, "no shutdown"); exec(r, "end");
  const out = exec(r, "show ipv6 interface g0/0");
  assert.match(out, /  Global unicast address\(es\):\n    2001:DB8:ACAD:1::1, subnet is 2001:DB8:ACAD:1::\/64\n/);
  assert.match(out, /  Joined group address\(es\):\n    FF02::1\n    FF02::2\n    FF02::1:FF00:1\n  MTU is 1500 bytes/);
  assert.match(out, /Hosts use stateless autoconfig for addresses\.$/);
  assert.equal(exec(r, "show ipv6 interface g0/1"), "");
});

test("show ip interface brief: NVRAM for addresses the lab booted with, manual once typed, unset when never set, NVRAM again after a reload", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, cfg } = await import("../labs/kit.js");
  const r = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 1, 1, cfg("interface g0/0", "ip address 10.1.1.1 255.255.255.0"))], links: [] }).devices.R1;
  exec(r, "enable");
  assert.match(exec(r, "show ip interface brief"), /GigabitEthernet0\/0 +10\.1\.1\.1 +YES NVRAM /);
  assert.match(exec(r, "show ip interface brief"), /GigabitEthernet0\/1 +unassigned +YES unset /);
  for (const c of ["configure terminal", "interface g0/1", "ip address 10.2.2.1 255.255.255.0", "end"]) exec(r, c);
  assert.match(exec(r, "show ip interface brief"), /GigabitEthernet0\/1 +10\.2\.2\.1 +YES manual /);
  exec(r, "copy running-config startup-config"); exec(r, "");
  exec(r, "reload"); exec(r, "");
  exec(r, "enable");
  assert.match(exec(r, "show ip interface brief"), /GigabitEthernet0\/1 +10\.2\.2\.1 +YES NVRAM /);
});

test("show ip ospf interface prints the ios 15 lines (attached via, topology table, oob-resync, nsf, flood) and a loopback as a stub host", async () => {
  const { LABS } = await import("../labs/index.js");
  const { buildLab, runSolution } = await import("../engine/lab.js");
  const l = buildLab(LABS.find((x) => x.id === "sim-ospf"));
  runSolution(l);
  const r = l.devices.R1;
  exec(r, "end");
  const out = exec(r, "show ip ospf interface");
  assert.match(out, /Area 0, Attached via Network Statement\n.*Cost: 1\n  Topology-MTID    Cost    Disabled    Shutdown      Topology Name\n        0           1         no          no            Base\n/);
  assert.match(out, /    oob-resync timeout 40\n    Hello due in 00:00:04\n  Supports Link-local Signaling \(LLS\)/);
  assert.match(out, /  Index 2\/2, flood queue length 0/);
  assert.match(out, /Network Type LOOPBACK, Cost: 1\n(.*\n){2}  Loopback interface is treated as a stub Host/);
});

test("show etherchannel summary has the second flags block a 2960 prints", () => {
  const s = createDevice("switch", "SW1");
  exec(s, "enable");
  assert.match(exec(s, "show etherchannel summary"), /f - failed to allocate aggregator\n\n        M - not in use, minimum links not met\n        u - unsuitable for bundling\n        w - waiting to be aggregated\n        d - default port\n\n\nNumber of channel-groups in use: 0/);
});

test("a router on ipv6 address autoconfig takes an address from every /64 prefix the far router advertises", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 1, 1, cfg("ipv6 unicast-routing", "interface g0/0", "ipv6 address 2001:db8:acad:1::1/64", "ipv6 address 2001:db8:acad:2::1/64", "no shutdown")), R("R2", 2, 2, cfg("interface g0/0", "ipv6 address autoconfig", "no shutdown"))], links: [["R1", "g0/0", "R2", "g0/0"]] });
  exec(l.devices.R2, "enable");
  const out = exec(l.devices.R2, "show ipv6 interface brief");
  assert.match(out, /2001:DB8:ACAD:1:/);
  assert.match(out, /2001:DB8:ACAD:2:/);
});

test("no shutdown logs %LINK-3-UPDOWN (LINK-5-CHANGED is only for administratively down)", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R } = await import("../labs/kit.js");
  const r = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 1, 1), R("R2", 2, 2)], links: [["R1", "g0/0", "R2", "g0/0"]] }).devices.R1;
  for (const c of ["enable", "configure terminal", "interface g0/1"]) exec(r, c);
  assert.equal(exec(r, "no shutdown"), "%LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down");
  assert.match(exec(r, "shutdown"), /^%LINK-5-CHANGED: Interface GigabitEthernet0\/1, changed state to administratively down/);
});

test("show ip route <address> prints the ios 15 entry: supernet, ospf type, last update, from, route metric", async () => {
  const { LABS } = await import("../labs/index.js");
  const { buildLab, runSolution } = await import("../engine/lab.js");
  const l = buildLab(LABS.find((x) => x.id === "ch-ospf-edge"));
  runSolution(l);
  const r = l.devices.R1;
  exec(r, "end");
  assert.match(exec(r, "show ip route 0.0.0.0"), /^Routing entry for 0\.0\.0\.0\/0, supernet\n  Known via "ospf 1", distance 110, metric 1, candidate default path\n  Tag 1, type extern 2, forward metric \d+\n  Last update from [\d.]+ on GigabitEthernet0\/\d, 00:12:41 ago\n  Routing Descriptor Blocks:\n  \* [\d.]+, from [\d.]+, 00:12:41 ago, via GigabitEthernet0\/\d\n      Route metric is 1, traffic share count is 1\n      Route tag 1$/);
  assert.match(exec(r, "show ip route 10.2.2.0"), /Known via "ospf 1", distance 110, metric 2, type intra area\n/);
  assert.match(exec(r, "show ip route 10.1.1.0"), /Known via "connected", distance 0, metric 0 \(connected, via interface\)\n  Routing Descriptor Blocks:\n  \* directly connected, via GigabitEthernet0\/0\n      Route metric is 0, traffic share count is 1$/);
});

test("dhcp server: leases expire by the router's clock; show ip dhcp server statistics counts the messages", async () => {
  const { LABS } = await import("../labs/index.js");
  const { buildLab, runSolution } = await import("../engine/lab.js");
  const l = buildLab(LABS.find((x) => x.id === "ch-dhcp-sites"));
  runSolution(l);
  const r = l.devices.R1;
  exec(r, "end");
  assert.match(exec(r, "show ip dhcp binding"), /Mar 02 1993 12:13 PM +Automatic/);
  const st = exec(r, "show ip dhcp server statistics");
  assert.match(st, /^Memory usage +\d+\nAddress pools +2\n/);
  assert.match(st, /DHCPDISCOVER +2\nDHCPREQUEST +2\n/);
  assert.match(st, /Message +Sent\nBOOTREPLY +0\nDHCPOFFER +2\nDHCPACK +2\nDHCPNAK +0$/);
});

test("port security shutdown: the 2960's log order in one burst, and show interfaces says (err-disabled)", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [S("SW1", 1, 1, cfg("service timestamps log datetime msec", "interface fa0/1", "switchport mode access", "switchport port-security", "switchport port-security mac-address 0050.7966.0001")), HOST("PC1", 1, 1, "windows", { ip: "10.0.0.1/24", mac: "0050.7966.6800" }), HOST("PC2", 1, 1, "linux", { ip: "10.0.0.2/24" })], links: [["SW1", "fa0/1", "PC1", "fa0"], ["SW1", "fa0/2", "PC2", "fa0"]] });
  const s = l.devices.SW1;
  exec(l.devices.PC1, "ping 10.0.0.2");
  exec(s, "enable");
  const log = exec(s, "show logging | include %").split("\n").filter((x) => x.startsWith("*"));
  assert.deepEqual(log.map((x) => x.split(": ")[1].split(":")[0]), ["%PM-4-ERR_DISABLE", "%PORT_SECURITY-2-PSECURE_VIOLATION", "%LINEPROTO-5-UPDOWN", "%LINK-3-UPDOWN"]);
  assert.equal(new Set(log.map((x) => x.slice(0, 18))).size, 1);
  assert.match(exec(s, "show interfaces fa0/1"), /^FastEthernet0\/1 is down, line protocol is down \(err-disabled\)/);
  assert.match(exec(s, "show interfaces fa0/3"), /^FastEthernet0\/3 is down, line protocol is down \(notconnect\)/);
  exec(s, "configure terminal"); exec(s, "interface fa0/3"); exec(s, "shutdown"); exec(s, "end");
  assert.match(exec(s, "show interfaces fa0/3"), /^FastEthernet0\/3 is administratively down, line protocol is down \(disabled\)/);
});

test("the running config lists static routes sorted by prefix, then mask", () => {
  const r = createDevice("router", "R1");
  for (const c of ["enable", "configure terminal", "interface g0/0", "ip address 10.0.13.1 255.255.255.252", "no shutdown", "exit", "ip route 10.2.2.128 255.255.255.128 10.0.13.2", "ip route 0.0.0.0 0.0.0.0 10.0.13.2", "ip route 10.2.2.0 255.255.255.0 10.0.13.2 130", "end"]) exec(r, c);
  assert.equal(exec(r, "show running-config | include ip route"), "ip route 0.0.0.0 0.0.0.0 10.0.13.2\nip route 10.2.2.0 255.255.255.0 10.0.13.2 130\nip route 10.2.2.128 255.255.255.128 10.0.13.2");
});

test("show logging: buffered logging on by default in the ios 15 layout, the buffer kept by its level, no logging buffered", () => {
  const s = createDevice("switch", "SW1");
  for (const c of ["enable", "configure terminal", "interface fa0/1", "shutdown", "no shutdown", "end"]) exec(s, c);
  const out = exec(s, "show logging");
  assert.match(out, /\nNo Active Message Discriminator\.\n\n\n\nNo Inactive Message Discriminator\.\n\n\n    Console logging: level debugging/);
  assert.match(out, /    Buffer logging:  level debugging, \d+ messages logged, xml disabled,\n                    filtering disabled\n    Exception Logging: size \(4096 bytes\)/);
  assert.match(out, /\n        Logging Source-Interface:       VRF Name:\n\nLog Buffer \(4096 bytes\):\n/);
  for (const c of ["configure terminal", "no logging buffered", "end"]) exec(s, c);
  const off = exec(s, "show logging");
  assert.match(off, /Buffer logging:  disabled/);
  assert.doesNotMatch(off, /Log Buffer/);
  assert.match(exec(s, "show running-config | include logging buffered"), /^no logging buffered$/);
});

test("show ntp status has the ios 15 lines after precision; show ntp associations columns line up under the header", async () => {
  const { LABS } = await import("../labs/index.js");
  const { buildLab, runSolution } = await import("../engine/lab.js");
  const l = buildLab(LABS.find((x) => x.id === "ch-time-ticket"));
  runSolution(l);
  const d = l.devices.SW1;
  exec(d, "end");
  assert.match(exec(d, "show ntp status"), /precision is 2\*\*24\nntp uptime is \d+ \(1\/100 of seconds\), resolution is 4000\nreference time is [0-9A-F]{8}\.[0-9A-F]{8} \(09:14:11\.542 UTC Tue Nov 3 2026\)\nclock offset is [\d.]+ msec, root delay is [\d.]+ msec\nroot dispersion is [\d.]+ msec, peer dispersion is [\d.]+ msec\nloopfilter state is 'CTRL' \(Normal Controlled Loop\), drift is [\d.]+ s\/s\nsystem poll interval is 64, last update was 11 sec ago\.$/);
  const [head, row] = exec(d, "show ntp associations").split("\n");
  for (const col of ["st", "when", "poll", "reach", "delay", "offset", "disp"]) {
    const end = head.indexOf(col) + col.length;
    assert.notEqual(row[end - 1], " ", `${col} column`);
    assert.ok(row[end] === " " || row[end] === undefined, `${col} column end`);
  }
});

test("PAT toward a router in the lab: the reply comes back to the inside global address", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, S, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    R("R1", 50, 10, cfg("interface g0/0", "ip address 192.168.1.1 255.255.255.0", "ip nat inside", "no shutdown", "interface g0/1", "ip address 203.0.113.2 255.255.255.252", "ip nat outside", "no shutdown", "exit",
      "access-list 1 permit 192.168.1.0 0.0.0.255", "ip nat inside source list 1 interface g0/1 overload", "ip route 0.0.0.0 0.0.0.0 203.0.113.1")),
    R("ISP", 80, 10, cfg("hostname ISP", "interface g0/0", "ip address 203.0.113.1 255.255.255.252", "no shutdown", "interface loopback 0", "ip address 8.8.8.8 255.255.255.255")),
    S("SW1", 50, 40),
    HOST("PC1", 20, 70, "windows", { ip: "192.168.1.11/24", gateway: "192.168.1.1" }), HOST("PC2", 30, 70, "windows", { ip: "192.168.1.12/24", gateway: "192.168.1.1" })],
    links: [["R1", "g0/1", "ISP", "g0/0"], ["R1", "g0/0", "SW1", "g0/1"], ["SW1", "fa0/1", "PC1", "fa0"], ["SW1", "fa0/2", "PC2", "fa0"]] });
  const D = l.devices;
  assert.match(exec(D.PC1, "ping 8.8.8.8"), /Reply from 8\.8\.8\.8/);
  exec(D.PC2, "ping 8.8.8.8");
  exec(D.R1, "enable");
  assert.match(exec(D.R1, "show ip nat translations"), /icmp 203\.0\.113\.2:1\s+192\.168\.1\.11:1\s+8\.8\.8\.8:1\s+8\.8\.8\.8:1/);
  // both Windows PCs send ICMP ID 1: the second one gets 1024 on the outside
  assert.match(exec(D.R1, "show ip nat translations"), /icmp 203\.0\.113\.2:1024\s+192\.168\.1\.12:1\s+8\.8\.8\.8:1024\s+8\.8\.8\.8:1024/);
  // without NAT the ISP has no way back to 192.168.1.0/24
  exec(D.R1, "configure terminal");
  exec(D.R1, "no ip nat inside source list 1 interface g0/1 overload");
  exec(D.R1, "end");
  assert.doesNotMatch(exec(D.PC1, "ping 8.8.8.8"), /Reply from/);
});

test("static NAT from the outside: the NAT router answers for the inside global address and forwards to the inside host", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, S, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    R("R1", 50, 10, cfg("interface g0/0", "ip address 192.168.1.1 255.255.255.0", "ip nat inside", "no shutdown", "interface g0/1", "ip address 203.0.113.2 255.255.255.248", "ip nat outside", "no shutdown", "exit",
      "ip nat inside source static 192.168.1.100 203.0.113.5", "ip route 0.0.0.0 0.0.0.0 203.0.113.1")),
    R("ISP", 80, 10, cfg("hostname ISP", "interface g0/0", "ip address 203.0.113.1 255.255.255.248", "no shutdown")),
    S("SW1", 50, 40), HOST("WEB", 80, 70, "linux", { ip: "192.168.1.100/24", gateway: "192.168.1.1" })],
    links: [["R1", "g0/1", "ISP", "g0/0"], ["R1", "g0/0", "SW1", "g0/1"], ["SW1", "fa0/3", "WEB", "fa0"]] });
  const D = l.devices;
  exec(D.ISP, "enable");
  assert.match(exec(D.ISP, "ping 203.0.113.5"), /Success rate is [1-9]/);
  assert.match(exec(D.ISP, "traceroute 203.0.113.5"), /1 203\.0\.113\.2 .*\n\s+2 203\.0\.113\.5 /);
  // the private address itself is not reachable from outside
  assert.match(exec(D.ISP, "ping 192.168.1.100"), /Success rate is 0 percent/);
  exec(D.R1, "enable");
  exec(D.R1, "configure terminal");
  exec(D.R1, "no ip nat inside source static 192.168.1.100 203.0.113.5");
  exec(D.R1, "end");
  assert.match(exec(D.ISP, "ping 203.0.113.5"), /Success rate is 0 percent/);
});

test("the DHCP server pings before it offers: an address in use is a conflict, logged and never offered", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, S, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    R("R1", 50, 10, cfg("interface g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "exit", "ip dhcp pool LAN", "network 192.168.1.0 255.255.255.0", "default-router 192.168.1.1")),
    S("SW1", 50, 40),
    HOST("PRN", 20, 70, "linux", { ip: "192.168.1.2/24", gateway: "192.168.1.1" }),
    HOST("PC1", 50, 78, "windows", { dhcp: true }), HOST("PC2", 80, 70, "windows", { dhcp: true })],
    links: [["R1", "g0/0", "SW1", "g0/1"], ["SW1", "fa0/1", "PRN", "fa0"], ["SW1", "fa0/2", "PC1", "fa0"], ["SW1", "fa0/3", "PC2", "fa0"]] });
  const D = l.devices;
  for (const pc of ["PC1", "PC2"]) exec(D[pc], "ipconfig /renew");
  exec(D.R1, "enable");
  const conf = exec(D.R1, "show ip dhcp conflict");
  assert.match(conf, /^192\.168\.1\.2 {7}Ping {15}Mar 01 1993 \d\d:\d\d [AP]M$/m);
  // addresses the server leased itself are never conflicts
  assert.equal(conf.split("\n").length, 2);
  assert.doesNotMatch(exec(D.R1, "show ip dhcp binding"), /192\.168\.1\.2 /);
  assert.match(exec(D.R1, "show logging"), /%DHCPD-4-PING_CONFLICT: DHCP address conflict: {2}server pinged 192\.168\.1\.2\./);
  // the pool's next address skips the conflict as well as the leases
  assert.match(exec(D.R1, "show ip dhcp pool"), /^ 192\.168\.1\.5 +192\.168\.1\.1 /m);
  exec(D.R1, "clear ip dhcp conflict *");
  assert.equal(exec(D.R1, "show ip dhcp conflict").split("\n").length, 1);
  exec(D.R1, "configure terminal");
  exec(D.R1, "no ip dhcp conflict logging");
  exec(D.R1, "end");
  assert.match(exec(D.R1, "show running-config"), /^no ip dhcp conflict logging$/m);
});

test("show spanning-tree detail: the transmit hold-count and the port the last topology change came from", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    S("SW1", 50, 10, cfg("spanning-tree mode rapid-pvst", "spanning-tree vlan 1 priority 4096")), S("SW2", 20, 60, cfg("spanning-tree mode rapid-pvst"))],
    links: [["SW1", "g0/1", "SW2", "g0/1"]] });
  exec(l.devices.SW2, "enable");
  const out = exec(l.devices.SW2, "show spanning-tree detail");
  assert.match(out, /^ {2}Configured hello time 2, max age 20, forward delay 15, transmit hold-count 6$/m);
  assert.match(out, /last change occurred .* ago\n {10}from GigabitEthernet0\/1\n {2}Times:/);
});

test("syslog messages shown on the console are kept in the log buffer by level; clear logging asks first", () => {
  const r = createDevice("router", "R1");
  for (const c of ["enable", "configure terminal", "logging buffered 8192 warnings", "interface g0/0", "shutdown", "no shutdown", "end"]) exec(r, c);
  const out = exec(r, "show logging");
  // %LINK-3 (no cable: the link goes down) is a warning or worse, %SYS-5-CONFIG_I is not
  assert.match(out, /Log Buffer \(8192 bytes\):\n\n%LINK-3-UPDOWN: Interface GigabitEthernet0\/0, changed state to down$/);
  assert.match(out, /Console logging: level debugging, 2 messages logged/);
  assert.equal(exec(r, "clear logging"), "");
  assert.equal(exec(r, ""), "");
  assert.doesNotMatch(exec(r, "show logging"), /%LINK-3-UPDOWN/);
});

test("clear logging empties the buffer but the per-destination counts go on", () => {
  const r = createDevice("router", "R1");
  for (const c of ["enable", "configure terminal", "interface g0/0", "no shutdown", "end"]) exec(r, c);
  assert.match(exec(r, "show logging"), /Console logging: level debugging, 2 messages logged/);
  exec(r, "clear logging"); exec(r, "");
  for (const c of ["configure terminal", "end"]) exec(r, c);
  const out = exec(r, "show logging");
  assert.match(out, /Console logging: level debugging, 3 messages logged/);
  assert.equal(out.split("Log Buffer (4096 bytes):\n\n")[1].split("\n").length, 1);
});

test("show interfaces switchport on an access port with a voice VLAN, and an IP phone's CDP entry", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((x) => x.id === "voice-vlan");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const c of lines) exec(l.devices[k.split("#")[0]], c);
  const sw = l.devices.SW1;
  exec(sw, "end");
  const out = exec(sw, "show interfaces fa0/3 switchport");
  // an access port runs no DTP
  assert.match(out, /^Negotiation of Trunking: Off$/m);
  assert.match(out, /Trunking Native Mode VLAN: 1 \(default\)\nAdministrative Native VLAN tagging: enabled\nVoice VLAN: 150 \(VOICE\)\nAdministrative private-vlan host-association: none/);
  assert.match(out, /Capture VLANs Allowed: ALL\n\nProtected: false\nUnknown unicast blocked: disabled\nUnknown multicast blocked: disabled\nAppliance trust: none$/);
  const cdp = exec(sw, "show cdp neighbors detail");
  const phone = cdp.split("-------------------------").find((b) => b.includes("IP Phone"));
  assert.match(phone, /Port ID \(outgoing port\): Port 1/);
  assert.doesNotMatch(phone, /Technical Support/);
});

test("show ip ospf neighbor detail numbers each neighbor's Index, and a new DR and BDR after the DR goes away", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, S, cfg } = await import("../labs/kit.js");
  const rt = (id, ip) => cfg("interface g0/0", `ip address 10.0.0.${ip} 255.255.255.0`, "no shutdown", "router ospf 1", `router-id ${id}`, "network 10.0.0.0 0.0.0.255 area 0");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 20, 10, rt("1.1.1.1", 1)), R("R2", 40, 10, rt("2.2.2.2", 2)), R("R3", 60, 10, rt("3.3.3.3", 3)), S("SW1", 50, 30)],
    links: [["R1", "g0/0", "SW1", "g0/1"], ["R2", "g0/0", "SW1", "g0/2"], ["R3", "g0/0", "SW1", "fa0/1"]] });
  const D = l.devices;
  exec(D.R1, "enable");
  const d = exec(D.R1, "show ip ospf neighbor detail");
  assert.match(d, /Neighbor 2\.2\.2\.2[\s\S]*Index 1\/1\/1,[\s\S]*Neighbor 3\.3\.3\.3[\s\S]*Index 2\/2\/2,/);
  assert.match(d, /DR is 10\.0\.0\.3 BDR is 10\.0\.0\.2/);
  for (const c of ["enable", "configure terminal", "interface g0/0", "shutdown"]) exec(D.R3, c);
  // the BDR takes over as DR and R1 becomes the BDR
  assert.match(exec(D.R1, "show ip ospf neighbor detail"), /DR is 10\.0\.0\.2 BDR is 10\.0\.0\.1/);
  assert.match(exec(D.R1, "show logging"), /Nbr 3\.3\.3\.3 on GigabitEthernet0\/0 from FULL to DOWN, Neighbor Down: Dead timer expired/);
});

test("the DR election is not preemptive: a returning DR is a DROTHER, a higher priority waits for every router to restart", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, S, cfg } = await import("../labs/kit.js");
  const rt = (id, ip) => cfg("interface g0/0", `ip address 10.0.0.${ip} 255.255.255.0`, "no shutdown", "router ospf 1", `router-id ${id}`, "network 10.0.0.0 0.0.0.255 area 0");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 20, 10, rt("1.1.1.1", 1)), R("R2", 40, 10, rt("2.2.2.2", 2)), R("R3", 60, 10, rt("3.3.3.3", 3)), S("SW1", 50, 30)],
    links: [["R1", "g0/0", "SW1", "g0/1"], ["R2", "g0/0", "SW1", "g0/2"], ["R3", "g0/0", "SW1", "fa0/1"]] });
  const D = l.devices;
  for (const n of ["R1", "R2", "R3"]) exec(D[n], "enable");
  for (const c of ["configure terminal", "interface g0/0", "shutdown", "no shutdown", "end"]) exec(D.R3, c);
  assert.match(exec(D.R1, "show ip ospf neighbor"), /^3\.3\.3\.3 +1 +FULL\/DROTHER/m);
  assert.match(exec(D.R1, "show ip ospf neighbor"), /^2\.2\.2\.2 +1 +FULL\/DR /m);
  // R3 asks to win: nothing changes until every router has restarted OSPF
  for (const c of ["configure terminal", "interface g0/0", "ip ospf priority 200", "end"]) exec(D.R3, c);
  assert.match(exec(D.R1, "show ip ospf neighbor"), /^3\.3\.3\.3 +200 +FULL\/DROTHER/m);
  for (const n of ["R1", "R2", "R3"]) { exec(D[n], "clear ip ospf process"); exec(D[n], "yes"); }
  assert.match(exec(D.R1, "show ip ospf neighbor"), /^3\.3\.3\.3 +200 +FULL\/DR /m);
});

test("output filters are case-sensitive, as in IOS", () => {
  const r = createDevice("router", "R1");
  for (const c of ["enable", "configure terminal", "hostname EDGE", "end"]) exec(r, c);
  assert.equal(exec(r, "show running-config | include hostname"), "hostname EDGE");
  assert.equal(exec(r, "show running-config | include Hostname"), "");
  // "overruns" in the first line of show logging is not "ERR"
  assert.doesNotMatch(exec(r, "show logging | include ERR"), /overruns/);
});

test("HSRP: a returning higher-priority router takes over Active only with standby preempt", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, S, cfg } = await import("../labs/kit.js");
  for (const pre of [false, true]) {
    const rt = (ip, pri, p) => cfg("interface g0/0", `ip address 10.0.0.${ip} 255.255.255.0`, "standby 1 ip 10.0.0.254", `standby 1 priority ${pri}`, ...(p ? ["standby 1 preempt"] : []), "no shutdown");
    const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 20, 10, rt(1, 110, pre)), R("R2", 60, 10, rt(2, 100, false)), S("SW1", 40, 40)], links: [["R1", "g0/0", "SW1", "g0/1"], ["R2", "g0/0", "SW1", "g0/2"]] });
    const D = l.devices;
    exec(D.R2, "enable");
    assert.match(exec(D.R2, "show standby brief"), /Gi0\/0 +1 +100 +Standby/);
    for (const c of ["enable", "configure terminal", "interface g0/0", "shutdown"]) exec(D.R1, c);
    assert.match(exec(D.R2, "show standby brief"), /Gi0\/0 +1 +100 +Active/);
    exec(D.R1, "no shutdown");
    assert.match(exec(D.R2, "show standby brief"), pre ? /Gi0\/0 +1 +100 +Standby/ : /Gi0\/0 +1 +100 +Active/);
  }
});

test("show etherchannel port-channel names the last port bundled and un-bundled; shutdown logs LINEPROTO only for a port that was up", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "pagp");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const x of lines) exec(l.devices[k], x);
  const SW1 = l.devices.SW1;
  exec(SW1, "end");
  let pc = exec(SW1, "show etherchannel 2 port-channel");
  assert.match(pc, /GC                  = 0x00020001      HotStandBy port = null/);
  assert.match(pc, /Time since last port bundled:    0d:00h:00m:07s    Gi0\/2/);
  assert.doesNotMatch(pc, /Un-bundled/);
  exec(SW1, "configure terminal");
  exec(SW1, "interface fa0/5");
  assert.equal(exec(SW1, "shutdown"), "%LINK-5-CHANGED: Interface FastEthernet0/5, changed state to administratively down");
  exec(SW1, "interface g0/2");
  assert.match(exec(SW1, "shutdown"), /administratively down\n%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0\/2, changed state to down/);
  exec(SW1, "end");
  pc = exec(SW1, "show etherchannel 2 port-channel");
  assert.match(pc, /Number of ports = 1/);
  assert.match(pc, /Time since last port bundled:    0d:00h:00m:41s    Gi0\/2\nTime since last port Un-bundled: 0d:00h:00m:07s    Gi0\/2/);
  // the lacp lab starts bundled: that counts as long ago, and LACP has no GC line
  const lacp = LABS.find((x) => x.id === "lacp");
  const l2 = buildLab(lacp);
  for (const [k, lines] of Object.entries(lacp.solution)) for (const x of lines) exec(l2.devices[k], x);
  const out = exec(l2.devices.SW1, "show etherchannel 1 port-channel");
  assert.match(out, /Number of ports = 2\nHotStandBy port = null/);
});

test("a line that changes state because of the far end is logged there; a lab's setup is not", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "pagp");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const x of lines) exec(l.devices[k], x);
  const { SW1, SW2 } = l.devices;
  exec(SW1, "end");
  exec(SW2, "end");
  const log = (d) => exec(d, "show logging").split("\n").filter((x) => /^(\*Mar  1 [\d:.]+: )?%/.test(x)).map((x) => x.replace(/^\*Mar  1 [\d:.]+: /, ""));
  const before = log(SW2).length;
  for (const c of ["configure terminal", "interface g0/1", "shutdown", "interface g0/2"]) exec(SW1, c);
  // the last member going takes the port-channel down with it, on the switch typed on too
  assert.match(exec(SW1, "shutdown"), /Port-channel2, changed state to down\n%LINK-3-UPDOWN: Interface Port-channel2, changed state to down$/);
  assert.deepEqual(log(SW2).slice(before), [
    "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/1, changed state to down",
    "%LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down",
    "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/2, changed state to down",
    "%LINK-3-UPDOWN: Interface GigabitEthernet0/2, changed state to down",
    "%LINEPROTO-5-UPDOWN: Line protocol on Interface Port-channel2, changed state to down",
    "%LINK-3-UPDOWN: Interface Port-channel2, changed state to down",
  ]);
  // a serial line comes up on both routers once the DCE end clocks it; a router logs the link first
  const w = buildLab(LABS.find((x) => x.id === "ch-wan-branch"));
  const { HQ, BR } = w.devices;
  for (const c of ["enable", "configure terminal", "interface s0/0/0"]) exec(HQ, c);
  exec(BR, "enable");
  assert.doesNotMatch(exec(BR, "show logging"), /Serial0\/0\/0/);
  assert.equal(exec(HQ, "clock rate 128000"), "%LINEPROTO-5-UPDOWN: Line protocol on Interface Serial0/0/0, changed state to up");
  exec(HQ, "shutdown");
  assert.deepEqual(log(BR).filter((x) => x.includes("Serial")), [
    "%LINEPROTO-5-UPDOWN: Line protocol on Interface Serial0/0/0, changed state to up",
    "%LINK-3-UPDOWN: Interface Serial0/0/0, changed state to down",
    "%LINEPROTO-5-UPDOWN: Line protocol on Interface Serial0/0/0, changed state to down",
  ]);
});

test("show ip arp right-aligns the age under Age (min); an unanswered ARP is Incomplete with no interface", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "sim-roas");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const x of lines) exec(l.devices[k.split("#")[0]], x);
  const R1 = l.devices.R1;
  exec(R1, "end");
  exec(R1, "ping 192.168.10.99");
  const rows = exec(R1, "show ip arp").split("\n");
  assert.equal(rows[0], "Protocol  Address          Age (min)  Hardware Addr   Type   Interface");
  assert.ok(rows.includes("Internet  192.168.10.99           0   Incomplete      ARPA"));
  assert.match(rows[1], /^Internet  192\.168\.10\.1            -   [0-9a-f.]{14}  ARPA   GigabitEthernet0\/0\.10$/);
});


test("show mac address-table starts with the switch's 20 static CPU entries; dynamic, vlan and interface views leave them out", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const SW1 = buildLab(LABS.find((l) => l.id === "mac-table")).devices.SW1;
  exec(SW1, "enable");
  const rows = exec(SW1, "show mac address-table").split("\n");
  assert.equal(rows[5], " All    0100.0ccc.cccc    STATIC      CPU");
  assert.equal(rows[7], " All    0180.c200.0000    STATIC      CPU");
  assert.equal(rows[23], " All    0180.c200.0010    STATIC      CPU");
  assert.equal(rows[24], " All    ffff.ffff.ffff    STATIC      CPU");
  assert.equal(rows[25], "   1    0050.7966.6801    DYNAMIC     Fa0/1");
  assert.equal(rows.at(-1), "Total Mac Addresses for this criterion: 22");
  assert.match(exec(SW1, "show mac address-table static"), /criterion: 20$/);
  assert.match(exec(SW1, "show mac address-table dynamic"), /-----\n   1    0050\.7966\.6801/);
  assert.doesNotMatch(exec(SW1, "show mac address-table vlan 1"), /CPU/);
  assert.doesNotMatch(exec(SW1, "show mac address-table interface fa0/2"), /CPU/);
});


test("etherchannel summary marks a member whose far end went down as D", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "lacp");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const x of lines) exec(l.devices[k], x);
  const { SW1, SW2 } = l.devices;
  exec(SW1, "end");
  for (const c of ["configure terminal", "interface g0/2", "shutdown", "end"]) exec(SW2, c);
  assert.match(exec(SW1, "show etherchannel summary"), /1      Po1\(SU\)       LACP        Gi0\/1\(P\) Gi0\/2\(D\)$/);
});


test("a router learns a PC's MAC from the PC's ARP request and then loses no echo to it", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, S, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    R("R1", 50, 10, cfg("interface g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown")), S("SW1", 50, 40),
    HOST("PC1", 20, 80, "windows", { ip: "192.168.1.10/24", gateway: "192.168.1.1", mac: "0050.7966.6801" }),
    HOST("PC2", 80, 80, "windows", { ip: "192.168.1.20/24", gateway: "192.168.1.1", mac: "0050.7966.6802" }),
  ], links: [["R1", "g0/0", "SW1", "g0/1"], ["PC1", "fa0", "SW1", "fa0/1"], ["PC2", "fa0", "SW1", "fa0/2"]] });
  const { R1, PC1 } = l.devices;
  exec(R1, "enable");
  exec(PC1, "ping 192.168.1.1");
  assert.match(exec(R1, "show ip arp"), /\nInternet  192\.168\.1\.10            1   0050\.7966\.6801  ARPA   GigabitEthernet0\/0/);
  assert.match(exec(R1, "ping 192.168.1.10"), /\n!!!!!\n/);
  // one nobody has talked to yet still costs the first echo
  assert.match(exec(R1, "ping 192.168.1.20"), /\n\.!!!!\n/);
});


test("a router cannot reach a host on its subnet that sits in another VLAN: its ARP stays Incomplete", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, S, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    R("R1", 50, 10, cfg("interface g0/1", "ip address 192.168.20.1 255.255.255.0", "no shutdown")),
    S("SW1", 50, 40, cfg("vlan 20", "exit", "interface fa0/1", "switchport mode access", "switchport access vlan 20")),
    HOST("SRV1", 50, 80, "linux", { ip: "192.168.20.50/24", gateway: "192.168.20.1", mac: "0050.7966.7450" }),
  ], links: [["R1", "g0/1", "SW1", "fa0/1"], ["SW1", "fa0/10", "SRV1", "fa0"]] });
  const { R1, SW1 } = l.devices;
  exec(R1, "enable");
  assert.match(exec(R1, "ping 192.168.20.50"), /\n\.\.\.\.\.\nSuccess rate is 0 percent/);
  assert.match(exec(R1, "show ip arp"), /\nInternet  192\.168\.20\.50           0   Incomplete      ARPA$/);
  for (const c of ["enable", "configure terminal", "interface fa0/10", "switchport access vlan 20", "end"]) exec(SW1, c);
  assert.match(exec(R1, "ping 192.168.20.50"), /Success rate is (80|100) percent/);
});


test("with every router at priority 0 there is no DR: neighbors stay 2WAY and no route crosses the segment", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, cfg } = await import("../labs/kit.js");
  const r = (i, lan) => R(`R${i}`, i * 30, 10, cfg("interface g0/0", `ip address 10.0.12.${i} 255.255.255.0`, "ip ospf priority 0", "no shutdown", "interface loopback 0", `ip address ${lan} 255.255.255.0`, "router ospf 1", `router-id ${i}.${i}.${i}.${i}`, "network 0.0.0.0 255.255.255.255 area 0"));
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [r(1, "192.168.1.1"), r(2, "192.168.2.1")], links: [["R1", "g0/0", "R2", "g0/0"]] });
  const { R1, R2 } = l.devices;
  exec(R1, "enable");
  exec(R2, "enable");
  assert.match(exec(R1, "show ip ospf neighbor"), /2\.2\.2\.2           0   2WAY\/DROTHER/);
  assert.match(exec(R1, "show ip ospf interface g0/0"), /Priority 0\n  No designated router on this network\n  No backup designated router on this network\n/);
  assert.doesNotMatch(exec(R1, "show ip route"), /192\.168\.2\.0/);
  for (const c of ["configure terminal", "interface g0/0"]) exec(R2, c);
  assert.match(exec(R2, "ip ospf priority 1"), /Nbr 1\.1\.1\.1 on GigabitEthernet0\/0 from LOADING to FULL/);
  assert.match(exec(R1, "show ip route"), /O        192\.168\.2\.1\/32|O +192\.168\.2\.\d/);
});

test("show interfaces status right-aligns duplex and speed as a 2960 does; a port-channel shows its members' speed", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "lacp");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const x of lines) exec(l.devices[k], x);
  const SW1 = l.devices.SW1;
  exec(SW1, "end");
  const rows = exec(SW1, "show interfaces status").split("\n");
  assert.equal(rows[0], "Port      Name               Status       Vlan       Duplex  Speed Type");
  assert.ok(rows.includes("Fa0/1                        notconnect   1            auto   auto 10/100BaseTX"));
  assert.ok(rows.includes("Gi0/1                        connected    1          a-full a-1000 10/100/1000BaseTX"));
  assert.ok(rows.includes("Po1                          connected    1          a-full a-1000"));
});


test("a router that forwards to an address nobody answers on its subnet keeps it Incomplete", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, S, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    R("R1", 50, 10, cfg("interface g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "interface g0/1", "ip address 192.168.2.1 255.255.255.0", "no shutdown")),
    S("SW1", 20, 40), S("SW2", 80, 40),
    HOST("PC1", 20, 80, "windows", { ip: "192.168.1.10/24", gateway: "192.168.1.1", mac: "0050.7966.6801" }),
  ], links: [["R1", "g0/0", "SW1", "g0/1"], ["R1", "g0/1", "SW2", "g0/1"], ["PC1", "fa0", "SW1", "fa0/1"]] });
  const { R1, PC1 } = l.devices;
  exec(R1, "enable");
  assert.doesNotMatch(exec(R1, "show ip arp"), /192\.168\.2\.99/);
  assert.match(exec(PC1, "ping 192.168.2.99"), /Request timed out/);
  assert.match(exec(R1, "show ip arp"), /\nInternet  192\.168\.2\.99 +0   Incomplete      ARPA/);
});

test("show standby brief uses the IOS widths: Interface 12, the priority right-aligned under Pri", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "sim-hsrp");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const x of lines) exec(l.devices[k.split("#")[0]], x);
  const R1 = l.devices.R1;
  exec(R1, "end");
  const rows = exec(R1, "show standby brief").split("\n");
  assert.equal(rows[2], "Interface   Grp  Pri P State   Active          Standby         Virtual IP");
  assert.match(rows[3], /^Gi0\/0\.10    10   110 P Active  local           10\.10\.10\.3 +10\.10\.10\.1$/);
});

test("show ip dhcp binding has the IOS three-line header and 20/24/24 columns", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "ch-voice-desks");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const x of lines) exec(l.devices[k.split("#")[0]], x);
  const R1 = l.devices.R1;
  exec(R1, "enable");
  const rows = exec(R1, "show ip dhcp binding").split("\n");
  assert.equal(rows[1], "IP address          Client-ID/              Lease expiration        Type");
  assert.equal(rows[2], "                    Hardware address/");
  assert.equal(rows[3], "                    User name");
  assert.match(rows[4], /^10\.1[05]\.0\.\d+ +\S+ +[A-Z][a-z]{2} \d\d \d{4} \d\d:\d\d [AP]M    Automatic$/);
  assert.equal(rows[4].indexOf(rows[4].split(/ +/)[1]), 20);
});

test("show interfaces trunk uses the Catalyst widths (Port 12, Mode 17, Encapsulation 15)", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "sim-roas");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const x of lines) exec(l.devices[k.split("#")[0]], x);
  const SW1 = l.devices.SW1;
  exec(SW1, "end");
  const rows = exec(SW1, "show interfaces trunk").split("\n");
  assert.equal(rows[0], "Port        Mode             Encapsulation  Status        Native vlan");
  assert.equal(rows[1], "Gi0/1       on               802.1q         trunking      1");
  assert.equal(rows[3], "Port        Vlans allowed on trunk");
  assert.equal(rows[4], "Gi0/1       1-4094");
});


test("the version a neighbor advertises in CDP and LLDP is the one its show version prints, Compiled line included", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.id === "sim-roas");
  const l = buildLab(def);
  for (const [k, lines] of Object.entries(def.solution)) for (const x of lines) exec(l.devices[k.split("#")[0]], x);
  const { R1, SW1 } = l.devices;
  exec(R1, "end");
  exec(SW1, "end");
  const head = (d) => exec(d, "show version").split("\n").slice(0, 4).join("\n");
  assert.ok(exec(SW1, "show cdp neighbors detail").includes("Version :\n" + head(R1) + "\n\nadvertisement version: 2"));
  assert.ok(exec(R1, "show cdp neighbors detail").includes("Version :\n" + head(SW1) + "\n\nadvertisement version: 2"));
});


test("a switch alone among PCs is its own root bridge: hosts never take part in spanning tree", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const SW1 = buildLab(LABS.find((l) => l.id === "sim-roas")).devices.SW1;
  exec(SW1, "enable");
  const out = exec(SW1, "show spanning-tree vlan 1");
  assert.match(out, /Root ID    Priority    32769\n             Address     ([0-9a-f.]+)\n             This bridge is the root/);
  assert.equal(out.match(/Root ID[\s\S]*?Address     ([0-9a-f.]+)/)[1], SW1.mac);
});


test("show spanning-tree prints the bridge's Aging Time and the 32-dash Type column as a 2960 does", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const SW1 = buildLab(LABS.find((l) => l.id === "sim-roas")).devices.SW1;
  exec(SW1, "enable");
  const out = exec(SW1, "show spanning-tree vlan 1");
  assert.match(out, /Forward Delay 15 sec\n             Aging Time  300 sec\n\nInterface           Role Sts Cost      Prio\.Nbr Type\n------------------- ---- --- --------- -------- -{32}\n/);
});

test("show ip interface gives the all-ones broadcast address, not the subnet's", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const R1 = buildLab(LABS.find((l) => l.id === "sim-roas")).devices.R1;
  for (const c of ["enable", "configure terminal", "interface g0/1", "ip address 10.20.30.1 255.255.255.0", "end"]) exec(R1, c);
  const out = exec(R1, "show ip interface g0/1");
  assert.match(out, /\n  Broadcast address is 255\.255\.255\.255\n  Address determined by /);
});

test("show ip ospf interface <if> gives the interface's own Index, not 1/1 for every one", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const lab = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    { name: "R1", type: "router", x: 10, y: 10, setup: ["enable", "configure terminal", "interface g0/0", "ip address 10.0.12.1 255.255.255.0", "no shutdown", "interface g0/1", "ip address 192.168.10.1 255.255.255.0", "no shutdown", "router ospf 1", "network 10.0.12.0 0.0.0.255 area 0", "network 192.168.10.0 0.0.0.255 area 0", "end"] },
  ], links: [] });
  const R1 = lab.devices.R1;
  exec(R1, "enable");
  assert.match(exec(R1, "show ip ospf interface g0/0"), /\n  Index 1\/1, flood queue length 0\n/);
  assert.match(exec(R1, "show ip ospf interface g0/1"), /\n  Index 2\/2, flood queue length 0\n/);
});

test("an ACL entry with log reports the first packet of a flow at once, as 1 packet, and no more lines for it", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const def = LABS.find((l) => l.answers?.[2] === "%SEC-6-IPACCESSLOGDP");
  const lab = buildLab(def);
  for (const [dev, lines] of Object.entries(def.solution)) if (!dev.includes("#")) for (const c of lines) exec(lab.devices[dev], c);
  exec(lab.devices.PC1, "ping -c 4 10.0.20.80");
  const R1 = lab.devices.R1;
  const out = exec(R1, "show logging | include SEC");
  assert.equal(out.split("\n").filter((l) => l.includes("IPACCESSLOGDP")).length, 1);
  assert.match(out, /list 110 denied icmp 10\.0\.10\.11 -> 10\.0\.20\.80 \(8\/0\), 1 packet$/m);
  assert.match(exec(R1, "show access-lists"), /\(8 matches\)/);
});

test("log messages carry a time only with service timestamps log, on the console and in the buffer alike", () => {
  const r = createDevice("router", "R1");
  for (const c of ["enable", "configure terminal", "interface g0/0", "no shutdown", "end"]) exec(r, c);
  assert.match(exec(r, "show running-config"), /^no service timestamps log datetime msec$/m);
  assert.match(exec(r, "show logging"), /\n\n%LINK-3-UPDOWN: Interface GigabitEthernet0\/0, changed state to down\n%SYS-5-CONFIG_I: Configured from console by console$/);
  for (const c of ["configure terminal", "service timestamps log datetime msec", "interface g0/1"]) exec(r, c);
  const said = exec(r, "no shutdown");
  assert.match(said, /^\*Mar {2}1 \d\d:\d\d:\d\d\.\d{3}: %LINK-3-UPDOWN: Interface GigabitEthernet0\/1, changed state to down$/);
  exec(r, "end");
  const buf = exec(r, "show logging");
  assert.ok(buf.includes(said), "the console line is the buffer line");
  // show logging lists the old messages without logging them again
  assert.equal(exec(r, "show logging").split("\n").filter((x) => x.includes("GigabitEthernet0/1")).length, 1);
});

test("show ip dhcp pool pads the Leased/Excluded/Total row as IOS does", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const lab = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    { name: "R1", type: "router", x: 1, y: 1, setup: ["enable", "configure terminal", "ip dhcp excluded-address 10.1.1.1", "ip dhcp pool P", "network 10.1.1.0 255.255.255.0", "end"] },
  ], links: [] });
  const R1 = lab.devices.R1;
  exec(R1, "enable");
  assert.match(exec(R1, "show ip dhcp pool"), /\n 10\.1\.1\.2 {13}10\.1\.1\.1 {9}- 10\.1\.1\.254 {8}0 {4}\/ 1 {5}\/ 254$/);
});

test("a default from default-information originate carries the OSPF process ID as its external route tag", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, cfg } = await import("../labs/kit.js");
  const lab = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    R("R1", 1, 1, cfg("interface g0/0", "ip address 10.0.12.1 255.255.255.252", "no shutdown", "interface g0/1", "ip address 203.0.113.2 255.255.255.252", "no shutdown", "ip route 0.0.0.0 0.0.0.0 g0/1", "router ospf 10", "network 10.0.12.0 0.0.0.3 area 0", "default-information originate")),
    R("R2", 1, 1, cfg("interface g0/0", "ip address 10.0.12.2 255.255.255.252", "no shutdown", "router ospf 10", "network 10.0.12.0 0.0.0.3 area 0")),
    R("ISP", 1, 1, cfg("interface g0/0", "ip address 203.0.113.1 255.255.255.252", "no shutdown")),
  ], links: [["R1", "g0/0", "R2", "g0/0"], ["R1", "g0/1", "ISP", "g0/0"]] });
  const R2 = lab.devices.R2;
  exec(R2, "enable");
  assert.match(exec(R2, "show ip ospf database external"), /External Route Tag: 10$/m);
  assert.match(exec(R2, "show ip ospf database"), /^0\.0\.0\.0 .* 10$/m);
  assert.match(exec(R2, "show ip route 0.0.0.0"), /Tag 10, type extern 2/);
});

test("a full DHCP pool sends no offer: the client times out and takes an APIPA address, the server leases nothing more", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, S, HOST, cfg } = await import("../labs/kit.js");
  const lab = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    R("R1", 1, 1, cfg("ip dhcp excluded-address 192.168.50.1 192.168.50.4", "ip dhcp pool K", "network 192.168.50.0 255.255.255.248", "default-router 192.168.50.1", "exit", "interface g0/0", "ip address 192.168.50.1 255.255.255.248", "no shutdown")),
    S("SW1", 1, 1), HOST("PC1", 1, 1, "windows", { dhcp: true, mac: "0050.7966.6901" }), HOST("PC2", 1, 1, "windows", { dhcp: true, mac: "0050.7966.6902" }), HOST("PC3", 1, 1, "windows", { dhcp: true, mac: "0050.7966.6903" }),
  ], links: [["R1", "g0/0", "SW1", "g0/1"], ["SW1", "fa0/1", "PC1", "fa0"], ["SW1", "fa0/2", "PC2", "fa0"], ["SW1", "fa0/3", "PC3", "fa0"]] });
  const { PC1, PC2, PC3, R1 } = lab.devices;
  exec(PC1, "ipconfig /renew");
  exec(PC2, "ipconfig /renew");
  assert.match(exec(PC3, "ipconfig /renew"), /unable to contact your DHCP server\. Request has timed out\./);
  assert.match(exec(PC3, "ipconfig"), /Autoconfiguration IPv4 Address\. \. : 169\.254\./);
  exec(R1, "enable");
  assert.doesNotMatch(exec(R1, "show ip dhcp binding"), /null/);
  assert.match(exec(R1, "show ip dhcp pool"), / 2 {4}\/ 4 {5}\/ 6$/);
});

test("clear counters logs %CLEAR-5-COUNTERS once confirmed, on the console and in the buffer", () => {
  const r = createDevice("router", "R1");
  exec(r, "enable");
  exec(r, "clear counters g0/0");
  assert.equal(exec(r, ""), "%CLEAR-5-COUNTERS: Clear counter on interface GigabitEthernet0/0 by console");
  exec(r, "clear counters");
  assert.equal(exec(r, "n"), "");
  exec(r, "clear counters");
  assert.equal(exec(r, ""), "%CLEAR-5-COUNTERS: Clear counter on all interfaces by console");
  assert.equal(exec(r, "show logging").split("\n").filter((l) => l.includes("%CLEAR-5-COUNTERS")).length, 2);
});

test("a new speed or duplex on a linked port makes the link go down and come back, logged on both ends", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, cfg } = await import("../labs/kit.js");
  const lab = buildLab({ id: "t", tasks: [], solution: {}, devices: [S("SW1", 1, 1, cfg("interface fa0/24", "speed 100", "duplex full")), S("SW2", 1, 1)], links: [["SW1", "fa0/24", "SW2", "fa0/24"]] });
  const { SW1, SW2 } = lab.devices;
  for (const c of ["enable", "configure terminal", "interface fa0/24"]) exec(SW1, c);
  assert.equal(exec(SW1, "no duplex"), [
    "%LINEPROTO-5-UPDOWN: Line protocol on Interface FastEthernet0/24, changed state to down",
    "%LINK-3-UPDOWN: Interface FastEthernet0/24, changed state to down",
    "%LINK-3-UPDOWN: Interface FastEthernet0/24, changed state to up",
    "%LINEPROTO-5-UPDOWN: Line protocol on Interface FastEthernet0/24, changed state to up",
  ].join("\n"));
  exec(SW2, "enable");
  assert.equal(exec(SW2, "show logging | include FastEthernet0/24").split("\n").length, 4);
  // the same value again changes nothing
  assert.equal(exec(SW1, "no duplex"), "");
});

test("a channel member that comes up at another speed is suspended, and the switch logs CANNOT_BUNDLE2 once", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    S("SW1", 30, 30, cfg("interface range g0/1 - 2", "channel-group 1 mode active")),
    S("SW2", 70, 30, cfg("interface range g0/1 - 2", "channel-group 1 mode active"))],
    links: [["SW1", "g0/1", "SW2", "g0/1"], ["SW1", "g0/2", "SW2", "g0/2"]] });
  const { SW1, SW2 } = l.devices;
  for (const d of [SW1, SW2]) exec(d, "enable");
  assert.match(exec(SW1, "show etherchannel summary"), /Po1\(SU\)\s+LACP\s+Gi0\/1\(P\) Gi0\/2\(P\)/);
  for (const c of ["configure terminal", "interface g0/2"]) exec(SW1, c);
  const said = exec(SW1, "speed 100");
  assert.match(said, /changed state to up\n%EC-5-CANNOT_BUNDLE2: Gi0\/2 is not compatible with Gi0\/1 and will be suspended \(speed of Gi0\/2 is 100M, Gi0\/1 is 1000M\)$/);
  // the same speed again: still suspended, nothing logged
  assert.equal(exec(SW1, "speed 100"), "");
  exec(SW1, "end");
  // the far end sensed 100 Mb/s on its Gi0/2 too
  for (const d of [SW1, SW2]) assert.match(exec(d, "show etherchannel summary"), /Gi0\/1\(P\) Gi0\/2\(s\)/);
  assert.match(exec(SW1, "show etherchannel detail"), /Port state    = Up Mstr Susp/);
  assert.match(exec(SW1, "show interfaces port-channel 1"), /BW 1000000 Kbit\/sec/);
  assert.equal(exec(SW2, "show logging | include EC-5").split("\n").length, 1);
  // back to auto: it bundles again
  for (const c of ["configure terminal", "interface g0/2", "speed auto", "end"]) exec(SW1, c);
  assert.match(exec(SW1, "show etherchannel summary"), /Gi0\/1\(P\) Gi0\/2\(P\)/);
});

test("plain spanning-tree portfast does nothing on a trunk; portfast trunk does, without the note about trunking", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, R, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    S("SW1", 30, 30, cfg("vlan 10", "interface g0/1", "switchport mode trunk")), R("R1", 70, 30, cfg("interface g0/0", "no shutdown"))],
    links: [["SW1", "g0/1", "R1", "g0/0"]] });
  const sw = l.devices.SW1;
  for (const c of ["enable", "configure terminal", "interface g0/1"]) exec(sw, c);
  assert.match(exec(sw, "spanning-tree portfast"), /Use with CAUTION\n\n%Portfast has been configured on GigabitEthernet0\/1 but will only\n have effect when the interface is in a non-trunking mode\.$/);
  exec(sw, "end");
  assert.equal(exec(sw, "show spanning-tree interface g0/1 portfast"), "VLAN0001            disabled\nVLAN0010            disabled");
  assert.doesNotMatch(exec(sw, "show spanning-tree vlan 10"), /Edge/);
  for (const c of ["configure terminal", "interface g0/1"]) exec(sw, c);
  assert.match(exec(sw, "spanning-tree portfast trunk"), /Use with CAUTION$/);
  exec(sw, "end");
  assert.equal(exec(sw, "show spanning-tree interface g0/1 portfast"), "VLAN0001            enabled\nVLAN0010            enabled");
  assert.match(exec(sw, "show spanning-tree vlan 10"), /Gi0\/1\s+Desg FWD 4\s+128\.25\s+P2p Edge/);
  assert.match(exec(sw, "show spanning-tree interface g0/1 detail"), /The port is in the portfast mode/);
});

test("a channel member at half duplex is suspended with the duplex form of CANNOT_BUNDLE2", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    S("SW1", 30, 30, cfg("interface range fa0/1 - 2", "channel-group 1 mode active")),
    S("SW2", 70, 30, cfg("interface range fa0/1 - 2", "channel-group 1 mode active"))],
    links: [["SW1", "fa0/1", "SW2", "fa0/1"], ["SW1", "fa0/2", "SW2", "fa0/2"]] });
  const { SW1, SW2 } = l.devices;
  for (const c of ["enable", "configure terminal", "interface fa0/2"]) exec(SW1, c);
  assert.match(exec(SW1, "duplex half"), /%EC-5-CANNOT_BUNDLE2: Fa0\/2 is not compatible with Fa0\/1 and will be suspended \(duplex of Fa0\/2 is half, Fa0\/1 is full\)$/);
  exec(SW1, "end");
  exec(SW2, "enable");
  // SW2's end is on auto and has to guess half at 100 Mb/s: it is suspended there too
  for (const d of [SW1, SW2]) assert.match(exec(d, "show etherchannel summary"), /Fa0\/1\(P\) Fa0\/2\(s\)/);
});

test("show lacp internal and sys-id; a partner's port number matches the one it uses itself", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    S("SW1", 30, 30, cfg("interface range g0/1 - 2", "channel-group 1 mode active")),
    S("SW2", 70, 30, cfg("interface range g0/1 - 2", "channel-group 1 mode passive"))],
    links: [["SW1", "g0/1", "SW2", "g0/1"], ["SW1", "g0/2", "SW2", "g0/2"]] });
  const { SW1, SW2 } = l.devices;
  for (const d of [SW1, SW2]) exec(d, "enable");
  const internal = exec(SW1, "show lacp internal");
  assert.match(internal, /^Flags:  S - Device is requesting Slow LACPDUs\n/);
  assert.match(internal, /\n\nChannel group 1\n                            LACP port     Admin     Oper    Port        Port\nPort      Flags   State     Priority      Key       Key     Number      State\nGi0\/1     SA      bndl      32768         0x1       0x1     0x119       0x3D\nGi0\/2     SA      bndl      32768         0x1       0x1     0x11a       0x3D/);
  assert.equal(exec(SW1, "show lacp 1 internal"), internal);
  assert.match(exec(SW2, "show lacp internal"), /Gi0\/1     SP      bndl/);
  assert.equal(exec(SW1, "show lacp sys-id"), `32768, ${SW1.mac}`);
  assert.match(exec(SW2, "show lacp neighbor"), new RegExp(`Gi0/1     SA      32768     ${SW1.mac.replace(/\./g, "\\.")}  25s    0x0    0x1    0x119   0x3D`));
});

test("show cdp traffic counts an hour of advertisements out of each cabled port and in from each CDP neighbor", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { S, R, PC, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 30, 30, cfg("interface g0/0", "no shutdown", "interface g0/1", "no shutdown")), S("SW1", 70, 30), PC("PC1", 50, 60, "10.0.0.10/24", "10.0.0.1")],
    links: [["R1", "g0/0", "SW1", "g0/1"], ["SW1", "fa0/1", "PC1", "fa0"]] });
  const { R1, SW1 } = l.devices;
  for (const d of [R1, SW1]) exec(d, "enable");
  assert.equal(exec(R1, "show cdp traffic"), "CDP counters :\n        Total packets output: 60, Input: 60\n        Hdr syntax: 0, Chksum error: 0, Encaps failed: 0\n        No memory: 0, Invalid packet: 0, Fragmented: 0\n        CDP version 1 advertisements output: 0, Input: 0\n        CDP version 2 advertisements output: 60, Input: 60");
  // the switch also sends out of the port to the PC, which sends nothing back
  assert.match(exec(SW1, "show cdp traffic"), /Total packets output: 120, Input: 60/);
  for (const c of ["configure terminal", "no cdp run", "end"]) exec(R1, c);
  assert.equal(exec(R1, "show cdp traffic"), "% CDP is not enabled");
});

test("netsh interface ip show config on Windows: static and DHCP forms, with the loopback", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 30, 30, cfg("interface g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown")), HOST("PC1", 50, 60, "windows", { ip: "192.168.1.10/24", gateway: "192.168.1.1", dns: ["8.8.8.8", "8.8.4.4"] })],
    links: [["R1", "g0/0", "PC1", "fa0"]] });
  const out = exec(l.devices.PC1, "netsh interface ip show config");
  assert.equal(out, [
    "",
    'Configuration for interface "Ethernet0"',
    "    DHCP enabled:                         No",
    "    IP Address:                           192.168.1.10",
    "    Subnet Prefix:                        192.168.1.0/24 (mask 255.255.255.0)",
    "    Default Gateway:                      192.168.1.1",
    "    Gateway Metric:                       0",
    "    InterfaceMetric:                      25",
    "    Statically Configured DNS Servers:    8.8.8.8",
    "                                          8.8.4.4",
    "    Register with which suffix:           Primary only",
    "    Statically Configured WINS Servers:   None",
    "",
    'Configuration for interface "Loopback Pseudo-Interface 1"',
    "    DHCP enabled:                         No",
    "    IP Address:                           127.0.0.1",
    "    Subnet Prefix:                        127.0.0.0/8 (mask 255.0.0.0)",
    "    InterfaceMetric:                      75",
    "    Statically Configured DNS Servers:    None",
    "    Register with which suffix:           None",
    "    Statically Configured WINS Servers:   None",
    "",
  ].join("\n"));
  assert.equal(exec(l.devices.PC1, "netsh interface ipv4 show config"), out);
  assert.match(exec(l.devices.PC1, "netsh interface ip show nonsense"), /^The following command was not found/);
});

test("dig and host as BIND prints them: the arguments in the header, @server, two or three tries, the reply size", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 30, 30, cfg("interface g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown")), HOST("PC1", 50, 60, "linux", { ip: "192.168.1.10/24", gateway: "192.168.1.1", dns: ["192.168.1.53"] }), HOST("PC2", 70, 60, "linux", { ip: "192.168.1.11/24", gateway: "192.168.1.1" })],
    links: [["R1", "g0/0", "PC1", "fa0"]] });
  const { PC1, PC2 } = l.devices;
  const t = ";; communications error to 192.168.1.53#53: timed out";
  assert.equal(exec(PC1, "dig www.example.com"), `${t}\n${t}\n${t}\n\n; <<>> DiG 9.18.39-0ubuntu0.24.04.9-Ubuntu <<>> www.example.com\n;; global options: +cmd\n;; no servers could be reached`);
  assert.match(exec(PC1, "dig www.example.com @10.9.9.9"), /^;; communications error to 10\.9\.9\.9#53: timed out\n[^]*<<>> www\.example\.com @10\.9\.9\.9\n/);
  assert.equal(exec(PC1, "host www.example.com"), `${t}\n${t}\n;; no servers could be reached`);
  // no nameserver at all: the resolver library falls back to 127.0.0.1
  const r = ";; communications error to 127.0.0.1#53: connection refused";
  assert.equal(exec(PC2, "host www.example.com"), `${r}\n${r}\n;; no servers could be reached`);
  assert.match(exec(PC2, "dig www.example.com"), new RegExp(`^${r}\n${r}\n${r}\n\n`));
});

test("tracepath prints iputils' format: the MTU probe, hop 1 twice, reached, !H for an ACL, and the Resume line", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [
    R("R1", 30, 30, cfg("interface g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "interface g0/1", "ip address 10.0.12.1 255.255.255.252", "no shutdown", "ip route 192.168.2.0 255.255.255.0 10.0.12.2")),
    R("R2", 60, 30, cfg("interface g0/0", "ip address 192.168.2.1 255.255.255.0", "no shutdown", "interface g0/1", "ip address 10.0.12.2 255.255.255.252", "no shutdown", "ip route 192.168.1.0 255.255.255.0 10.0.12.1", "access-list 101 deny ip any host 192.168.2.99", "access-list 101 permit ip any any", "interface g0/1", "ip access-group 101 in")),
    HOST("PC1", 10, 60, "linux", { ip: "192.168.1.10/24", gateway: "192.168.1.1" }), HOST("PC2", 80, 60, "linux", { ip: "192.168.2.10/24", gateway: "192.168.2.1" })],
    links: [["R1", "g0/0", "PC1", "fa0"], ["R1", "g0/1", "R2", "g0/1"], ["R2", "g0/0", "PC2", "fa0"]] });
  const pc = l.devices.PC1;
  const lines = exec(pc, "tracepath 192.168.2.10").split("\n");
  assert.equal(lines[0], " 1?: [LOCALHOST]                      pmtu 1500");
  assert.match(lines[1], /^ 1:  192\.168\.1\.1 {41}  0\.\d{3}ms $/);
  assert.match(lines[2], /^ 1:  192\.168\.1\.1 {41}  0\.\d{3}ms $/);
  assert.notEqual(lines[1], lines[2]);
  assert.match(lines[3], /^ 2:  10\.0\.12\.2 {43}  1\.\d{3}ms $/);
  assert.match(lines[4], /^ 3:  192\.168\.2\.10 {40}  2\.\d{3}ms reached$/);
  assert.equal(lines[5], "     Resume: pmtu 1500 hops 3 back 3 ");
  assert.match(exec(pc, "tracepath 192.168.2.99"), /\n 2:  10\.0\.12\.2 +1\.\d{3}ms !H\n     Resume: pmtu 1500 $/);
  assert.match(exec(pc, "tracepath"), /^\nUsage\n  tracepath \[options\] <destination>\n/);
  // traceroute's hop number is two columns wide
  assert.match(exec(pc, "traceroute 192.168.2.10"), /\n 1  192\.168\.1\.1 \(192\.168\.1\.1\)  /);
});

test("ip takes -4, -6 and -br as iproute2 does, and names unknown objects and commands its way", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 30, 30, cfg("interface g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown")), HOST("PC1", 50, 60, "linux", { ip: "192.168.1.10/24", gateway: "192.168.1.1" })],
    links: [["R1", "g0/0", "PC1", "fa0"]] });
  const pc = l.devices.PC1;
  const four = exec(pc, "ip -4 addr");
  assert.match(four, /^1: lo: <LOOPBACK,UP,LOWER_UP>[^\n]*\n    inet 127\.0\.0\.1\/8 scope host lo\n       valid_lft forever preferred_lft forever\n2: eth0: [^\n]*\n    inet 192\.168\.1\.10\/24 brd 192\.168\.1\.255 scope global eth0\n       valid_lft forever preferred_lft forever$/);
  const br = exec(pc, "ip -br a").split("\n");
  assert.equal(br[0], "lo               UNKNOWN        127.0.0.1/8 ::1/128 ");
  assert.match(br[1], /^eth0             UP             192\.168\.1\.10\/24 fe80::\S+\/64 $/);
  assert.match(exec(pc, "ip -br link"), /\neth0             UP             [0-9a-f:]{17} <BROADCAST,MULTICAST,UP,LOWER_UP> $/);
  assert.equal(exec(pc, "ip foo"), 'Object "foo" is unknown, try "ip help".');
  assert.equal(exec(pc, "ip addr foo bar"), 'Command "foo" is unknown, try "ip address help".');
  assert.equal(exec(pc, "ip -4 route"), exec(pc, "ip route"));
});

test("nslookup that gets no answer: three tries naming the server on Linux, one line on macOS; macOS has host", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 30, 30, cfg("interface g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown")), HOST("L1", 50, 60, "linux", { ip: "192.168.1.10/24", gateway: "192.168.1.1", dns: ["192.168.1.53"] }), HOST("M1", 70, 60, "mac", { ip: "192.168.1.11/24", gateway: "192.168.1.1", dns: ["192.168.1.53"] })],
    links: [["R1", "g0/0", "L1", "fa0"]] });
  const t = ";; communications error to 192.168.1.53#53: timed out\n";
  assert.equal(exec(l.devices.L1, "nslookup www.example.com"), `${t}${t}${t};; no servers could be reached\n`);
  assert.equal(exec(l.devices.M1, "nslookup www.example.com"), ";; connection timed out; no servers could be reached\n");
  assert.equal(exec(l.devices.M1, "host www.example.com"), ";; connection timed out; no servers could be reached");
});

test("Windows nslookup with no answer: the server lookup, then two tries for each of A and AAAA", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 30, 30, cfg("interface g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown")), HOST("W1", 50, 60, "windows", { ip: "192.168.1.10/24", gateway: "192.168.1.1", dns: ["192.168.1.53"] })],
    links: [["R1", "g0/0", "W1", "fa0"]] });
  const t = "DNS request timed out.\n    timeout was 2 seconds.\n";
  assert.equal(exec(l.devices.W1, "nslookup www.example.com"), `${t}Server:  UnKnown\nAddress:  192.168.1.53\n${t}${t}${t}${t}*** Request to UnKnown timed-out`);
});

test("a name outside the lab's zones is a server failure; a missing name inside one is NXDOMAIN with the zone's SOA", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const l = buildLab(LABS.find((x) => x.id === "linux-dns"));
  const pc = l.devices.PC1;
  const nx = exec(pc, "dig wwww.mycompany.lab");
  assert.match(nx, /status: NXDOMAIN, id: 41873\n;; flags: qr aa rd ra; QUERY: 1, ANSWER: 0, AUTHORITY: 1, ADDITIONAL: 0\n\n;; QUESTION SECTION:\n;wwww\.mycompany\.lab\.\t\tIN\tA\n\n;; AUTHORITY SECTION:\nmycompany\.lab\.\t\t3600\tIN\tSOA\tdns\.mycompany\.lab\. hostmaster\.mycompany\.lab\. 1 3600 600 86400 3600\n/);
  assert.match(nx, /MSG SIZE  rcvd: 87$/);
  const sf = exec(pc, "dig www.google.com");
  assert.match(sf, /status: SERVFAIL, id: 41873\n;; flags: qr rd ra; QUERY: 1, ANSWER: 0, AUTHORITY: 0, ADDITIONAL: 0\n/);
  assert.match(sf, /MSG SIZE  rcvd: 32$/);
  assert.match(exec(pc, "nslookup www.google.com"), /\*\* server can't find www\.google\.com: SERVFAIL$/);
  assert.equal(exec(pc, "host www.google.com"), "Host www.google.com not found: 2(SERVFAIL)");
  assert.equal(exec(pc, "host wwww.mycompany.lab"), "Host wwww.mycompany.lab not found: 3(NXDOMAIN)");
  assert.match(exec(pc, "ping -c 1 www.google.com"), /^ping: www\.google\.com: Temporary failure in name resolution$/);
  assert.match(exec(pc, "ping -c 1 wwww.mycompany.lab"), /^ping: wwww\.mycompany\.lab: Name or service not known$/);
  const w = buildLab(LABS.find((x) => x.id === "win-dns")).devices.PC1;
  assert.match(exec(w, "nslookup www.google.com"), /\*\*\* dns\.mycompany\.lab can't find www\.google\.com: Server failed$/);
  assert.match(exec(w, "nslookup wwww.mycompany.lab"), /can't find wwww\.mycompany\.lab: Non-existent domain$/);
});

test("DNS queries are UDP 53 through ACLs: an ACL that lets ping through but not domain stops name lookups", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const l = buildLab(LABS.find((x) => x.id === "linux-dns"));
  const pc = l.devices.PC1, r1 = l.devices.R1;
  assert.match(exec(pc, "host www.mycompany.lab"), /has address 10\.10\.20\.80/);
  for (const c of ["enable", "configure terminal", "access-list 120 permit icmp any any", "access-list 120 permit tcp any any eq domain", "interface g0/1", "ip access-group 120 out", "end"]) exec(r1, c);
  assert.match(exec(pc, "ping -c 1 10.10.20.10"), /1 received/);
  assert.match(exec(pc, "host wwww.mycompany.lab"), /communications error to 10\.10\.20\.10#53: timed out/);
  for (const c of ["configure terminal", "access-list 120 permit udp any any eq domain", "end"]) exec(r1, c);
  assert.match(exec(pc, "host wwww.mycompany.lab"), /not found: 3\(NXDOMAIN\)/);
});

test("no dns-server, no default-router and no domain-name in a DHCP pool", () => {
  const r = createDevice("router", "R1");
  for (const c of ["enable", "configure terminal", "ip dhcp pool LAN", "network 10.0.0.0 255.255.255.0", "default-router 10.0.0.1", "dns-server 10.0.0.53 10.0.0.54", "domain-name lab.local"]) exec(r, c);
  assert.equal(exec(r, "no dns-server 10.0.0.53"), "");
  assert.match(exec(r, "do show running-config | section dhcp pool"), / dns-server 10\.0\.0\.54\n/);
  for (const c of ["no dns-server", "no default-router", "no domain-name"]) assert.equal(exec(r, c), "");
  const run = exec(r, "do show running-config | section dhcp pool");
  assert.doesNotMatch(run, /dns-server|default-router|domain-name/);
});

test("a Linux or macOS ping's rtt summary is worked out from the replies it printed", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { R, S, HOST, cfg } = await import("../labs/kit.js");
  const l = buildLab({ id: "t", tasks: [], solution: {}, devices: [R("R1", 30, 30, cfg("interface g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown")), HOST("L1", 50, 60, "linux", { ip: "192.168.1.10/24", gateway: "192.168.1.1" }), HOST("M1", 70, 60, "mac", { ip: "192.168.1.11/24", gateway: "192.168.1.1" }), S("SW1", 50, 30)],
    links: [["R1", "g0/0", "SW1", "g0/1"], ["SW1", "fa0/1", "L1", "fa0"], ["SW1", "fa0/2", "M1", "fa0"]] });
  for (const [pc, re] of [[l.devices.L1, /time=([\d.]+) ms/g], [l.devices.M1, /time=([\d.]+) ms/g]]) {
    const out = exec(pc, "ping -c 4 192.168.1.1");
    const t = [...out.matchAll(re)].map((m) => Number(m[1]));
    const [min, avg, max] = out.match(/= ([\d.]+)\/([\d.]+)\/([\d.]+)\/[\d.]+ ms/).slice(1).map(Number);
    assert.equal(min, Math.min(...t));
    assert.equal(max, Math.max(...t));
    assert.ok(Math.abs(avg - t.reduce((a, b) => a + b, 0) / t.length) < 0.001);
  }
});

test("DNS queries count in the ACL that lets them through: dig one, host three", async () => {
  const { buildLab } = await import("../engine/lab.js");
  const { LABS } = await import("../labs/index.js");
  const l = buildLab(LABS.find((x) => x.id === "linux-dns"));
  const pc = l.devices.PC1, r1 = l.devices.R1;
  for (const c of ["enable", "configure terminal", "access-list 120 permit udp any any eq domain", "access-list 120 permit icmp any any", "interface g0/1", "ip access-group 120 out", "end"]) exec(r1, c);
  exec(pc, "dig www.mycompany.lab");
  assert.match(exec(r1, "show access-lists 120"), /10 permit udp any any eq domain \(1 match\)/);
  exec(pc, "host www.mycompany.lab");
  assert.match(exec(r1, "show access-lists 120"), /10 permit udp any any eq domain \(4 matches\)/);
});
