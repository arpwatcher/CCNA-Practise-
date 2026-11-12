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
  assert.match(exec(r1, "show ip dhcp pool BRANCH"), /10\.20\.20\.22\s+10\.20\.20\.1\s+- 10\.20\.20\.254\s+1 \/ 20 \/ 254/);
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
  assert.match(exec(ADMIN, "ssh netadmin@192.168.99.2"), /netadmin@192\.168\.99\.2's password:/);
  assert.match(exec(PC1, "ssh netadmin@192.168.99.2"), /port 22: Connection refused/);
  assert.match(exec(PC1, "ping 192.168.99.2"), /Reply from [\d.]+: bytes=/);
  // transport input ssh: telnet is refused
  assert.match(exec(R1, "telnet 192.168.99.2"), /Trying 192\.168\.99\.2 \.\.\.\n% Connection refused by remote host/);
  assert.match(exec(R1, "ssh -l netadmin 192.168.99.2"), /^Password:/);
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
  assert.match(out, /%PM-4-ERR_DISABLE: bpduguard error detected on Fa0\/1, putting Fa0\/1 in err-disable state/);
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
