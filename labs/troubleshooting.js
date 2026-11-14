import { lab, R, S, PC, HOST, cfg, EN, need, is } from "./kit.js?v=f65794c";
import { linkMode } from "../engine/net.js?v=f65794c";

const M = "troubleshooting";
const r1 = cfg("interface g0/0", "ip address 10.1.1.1 255.255.255.0", "no shutdown", "interface g0/1", "ip address 10.0.12.1 255.255.255.252", "no shutdown", "ip route 10.3.3.0 255.255.255.0 10.0.12.2");
const r2 = (extra = []) => cfg("interface g0/1", "ip address 10.0.12.2 255.255.255.252", "no shutdown", "interface g0/2", "ip address 10.0.23.1 255.255.255.252", "no shutdown", "ip route 10.3.3.0 255.255.255.0 10.0.23.2", ...extra);
// R3 also knows the R1-R2 link, so a plain ping from R1 (sourced from
// 10.0.12.1) gets its answer back
const r3 = (extra = []) => cfg("interface g0/0", "ip address 10.3.3.1 255.255.255.0", "no shutdown", "interface g0/2", "ip address 10.0.23.2 255.255.255.252", "no shutdown", "ip route 10.1.1.0 255.255.255.0 10.0.23.1", "ip route 10.0.12.0 255.255.255.252 10.0.23.1", ...extra);
const line = (b = [], c = []) => [R("R1", 18, 28, r1), R("R2", 50, 28, r2(b)), R("R3", 82, 28, r3(c)), PC("PC1", 18, 52, "10.1.1.10/24", "10.1.1.1"), PC("PC3", 82, 52, "10.3.3.10/24", "10.3.3.1")];
const links = [["R1", "g0/1", "R2", "g0/1"], ["R2", "g0/2", "R3", "g0/2"], ["R1", "g0/0", "PC1", "fa0"], ["R3", "g0/0", "PC3", "fa0"]];
const routeBack = (t) => t.statics("R2").some((r) => r.net === "10.1.1.0" && r.mask === "255.255.255.0" && r.via === "10.0.12.1");

export default [
  lab({
    id: "ping", module: M, title: "ping",
    cmds: ["ping"],
    devices: line(["ip route 10.1.1.0 255.255.255.0 10.0.12.1"]), links,
    intro: "Check end-to-end reachability from R1.",
    tasks: [
      { text: "From R1, ping R3's LAN interface 10.3.3.1.", check: (t) => need(t.ran("R1", /^ping 10\.3\.3\.1$/), "Run ping 10.3.3.1 on R1.") },
      { text: "Ping it again with 100 packets.", check: (t) => need(t.ran("R1", /^ping 10\.3\.3\.1 repeat 100$/), "Run ping 10.3.3.1 repeat 100.") },
    ],
    solution: { R1: ["enable", "ping 10.3.3.1", "ping 10.3.3.1 repeat 100"] },
    teach: "In IOS ping output, ! is a reply, . is a timeout and U is destination unreachable. The first ping often shows .!!!! because the first packet waits for ARP.",
  }),
  lab({
    id: "extended-ping", module: M, title: "Extended ping with a source",
    // the answer pings before the fix, to see the fault
    failingPings: true,
    cmds: ["ping source"],
    devices: line(), links,
    intro: "R1 can reach 10.3.3.1, but PC1's LAN cannot. A ping from R1's G0/1 address hides the problem.",
    tasks: [
      { text: "From R1, ping 10.3.3.1 using G0/0 (10.1.1.1) as the source.", check: (t) => need(t.ran("R1", /^ping 10\.3\.3\.1 source (GigabitEthernet0\/0|10\.1\.1\.1)$/), "Run ping 10.3.3.1 source g0/0 (or source 10.1.1.1).") },
      { text: "The reply has no way back to 10.1.1.0/24. Give R2 the missing route.", check: (t) => need(routeBack(t), "R2 needs ip route 10.1.1.0 255.255.255.0 10.0.12.1.") },
    ],
    solution: { R1: ["enable", "ping 10.3.3.1 source g0/0"], R2: [...EN, "ip route 10.1.1.0 255.255.255.0 10.0.12.1"] },
    teach: "A ping uses the address of the exit interface as its source. With source you test the path from a LAN, as a host there would. Typing ping alone starts the interactive extended ping.",
  }),
  lab({
    id: "traceroute", module: M, title: "traceroute",
    cmds: ["traceroute"],
    devices: line(["ip route 10.1.1.0 255.255.255.0 10.0.12.1"]), links,
    intro: "Find the path from R1 to PC3.",
    tasks: [{ text: "Trace the route from R1 to 10.3.3.10.", check: (t) => need(t.ran("R1", /^traceroute 10\.3\.3\.10$/), "Run traceroute 10.3.3.10 on R1 (tracert is the Windows command).") }],
    solution: { R1: ["enable", "traceroute 10.3.3.10"] },
    teach: "traceroute sends packets with TTL 1, 2, 3... and each router that drops one answers with ICMP Time Exceeded, which reveals the hops. * * * means that hop did not answer.",
  }),
  lab({
    id: "debug-icmp", module: M, title: "debug ip icmp and undebug all",
    cmds: ["debug ip icmp", "show debugging", "undebug all"],
    devices: line(["ip route 10.1.1.0 255.255.255.0 10.0.12.1"]), links,
    intro: "Watch the ICMP messages R3 sends and receives, then switch debugging off.",
    tasks: [
      { text: "On R3, turn on ICMP debugging.", check: (t) => need(t.ran("R3", /^debug ip icmp$/), "Run debug ip icmp on R3.") },
      { text: "Check which debugs are on.", check: (t) => need(t.ran("R3", /^show debugging$/), "Run show debugging.") },
      { text: "Turn every debug off.", check: (t) => need(t.ran("R3", /^(undebug all|no debug all)$/) && !t.dev("R3").debugs.length, "Run undebug all (u all).") },
    ],
    solution: { R3: ["enable", "debug ip icmp", "show debugging", "undebug all"] },
    teach: "debug output can overload a busy router, so turn it off as soon as you are done. Debug output appears on the console; over Telnet/SSH you also need terminal monitor.",
  }),
  lab({
    id: "sim-connectivity", module: M, title: "Sim: PC1 cannot reach PC3", kind: "sim",
    // the answer pings before the fix, to see the fault
    failingPings: true,
    cmds: ["ping", "traceroute", "show ip interface brief", "show ip route"],
    devices: [R("R1", 18, 28, r1), R("R2", 50, 28, r2()), R("R3", 82, 28, r3(["interface g0/2", "shutdown"])), PC("PC1", 18, 52, "10.1.1.10/24", "10.1.1.1"), PC("PC3", 82, 52, "10.3.3.10/24", "10.3.3.1")],
    links,
    intro: "Users on PC1 report that PC3 is unreachable. Find both faults and fix them.",
    tasks: [
      { text: "Test from R1 with a ping sourced from its LAN.", check: (t) => need(t.ran("R1", /^ping 10\.3\.3\.(1|10) source/), "Start with ping 10.3.3.10 source g0/0 on R1.") },
      { text: "Find and fix the interface fault on the path.", check: (t) => need(t.up("R3", "g0/2"), "One link on the path is down. Check show ip interface brief on each router.") },
      { text: "Find and fix the routing fault on the path.", check: (t) => need(routeBack(t), "Return traffic to 10.1.1.0/24 has no route on one router. Check show ip route on R2.") },
    ],
    solution: { R1: ["enable", "ping 10.3.3.10 source g0/0"], R3: [...EN, "interface g0/2", "no shutdown"], R2: [...EN, "ip route 10.1.1.0 255.255.255.0 10.0.12.1"] },
    teach: "Work layer by layer: interface status (show ip interface brief), then addressing, then routing in both directions (show ip route on every hop).",
  }),  lab({
    id: "sim-routing-loop", module: M, title: "Sim: TTL expired in transit (a routing loop)", kind: "sim",
    cmds: ["ping", "tracert", "show ip route", "ip route"],
    devices: [
      R("R1", 18, 28, r1),
      R("R2", 50, 28, cfg("interface g0/1", "ip address 10.0.12.2 255.255.255.252", "no shutdown", "interface g0/2", "ip address 10.0.23.1 255.255.255.252", "no shutdown", "ip route 10.3.3.0 255.255.255.0 10.0.12.1", "ip route 10.1.1.0 255.255.255.0 10.0.12.1")),
      R("R3", 82, 28, r3()),
      HOST("PC1", 18, 52, "windows", { ip: "10.1.1.10/24", gateway: "10.1.1.1" }),
      PC("PC3", 82, 52, "10.3.3.10/24", "10.3.3.1"),
    ],
    links,
    intro: "PC1 cannot reach PC3 (10.3.3.10), and the error it gets is not the usual one. Read what PC1 says, find the loop and fix it.",
    tasks: [
      { text: "Ping 10.3.3.10 from PC1. What comes back?", choices: ["Reply from 10.0.12.2: TTL expired in transit.", "Reply from 10.1.1.1: Destination net unreachable.", "Request timed out.", "Reply from 10.1.1.10: Destination host unreachable."], check: (t) => need(t.ran("PC1", /^ping .*10\.3\.3\.10/) && t.reply === "Reply from 10.0.12.2: TTL expired in transit.", "Every echo goes back and forth until its TTL (128 on Windows) reaches 0; the router where that happens answers TTL expired in transit.") },
      { text: "Run tracert 10.3.3.10 on PC1. Which addresses keep coming back, one after the other, until the 30 hops run out?", choices: ["10.0.12.2 and 10.0.12.1", "10.1.1.1 and 10.0.12.2", "10.0.23.1 and 10.0.23.2", "10.3.3.1 and 10.0.23.2"], check: (t) => need(t.ran("PC1", /^tracert .*10\.3\.3\.10/) && t.reply === "10.0.12.2 and 10.0.12.1", "After 10.1.1.1 the trace alternates R2 (10.0.12.2) and R1 (10.0.12.1): the packet bounces on the R1-R2 link.") },
      { text: "Fix it: on the router that sends the traffic back, point the route to 10.3.3.0/24 at R3 (10.0.23.2), so that PC1 reaches PC3.", check: (t) => need(t.statics("R2").some((r) => r.net === "10.3.3.0" && r.via === "10.0.23.2") && !t.statics("R2").some((r) => r.net === "10.3.3.0" && r.via === "10.0.12.1") && t.reach("PC1", "10.3.3.10"), "show ip route on R2: 10.3.3.0/24 goes via 10.0.12.1, back to R1. no ip route 10.3.3.0 255.255.255.0 10.0.12.1, then ip route 10.3.3.0 255.255.255.0 10.0.23.2.") },
      { text: "Why did the packets loop instead of being dropped?", choices: ["R1 and R2 each had a route for 10.3.3.0/24 pointing at the other", "R2 had no route for 10.3.3.0/24", "R3 had no route back to PC1", "An ACL on R2 blocked the echoes"], check: (t) => need(t.reply === "R1 and R2 each had a route for 10.3.3.0/24 pointing at the other", "With no route R2 would have answered net unreachable; here it had one, pointing back at R1. Static routes have no loop prevention: only the TTL ends it.") },
    ],
    solution: { "PC1": ["ping 10.3.3.10", "tracert 10.3.3.10"], R2: [...EN, "do show ip route", "no ip route 10.3.3.0 255.255.255.0 10.0.12.1", "ip route 10.3.3.0 255.255.255.0 10.0.23.2"], "PC1#2": ["ping 10.3.3.10"] },
    answers: { 0: "Reply from 10.0.12.2: TTL expired in transit.", 1: "10.0.12.2 and 10.0.12.1", 3: "R1 and R2 each had a route for 10.3.3.0/24 pointing at the other" },
    failingPings: true,
    teach: "Every IP packet carries a TTL that each router lowers by one. In a routing loop the packet goes round until the TTL hits 0, and the router where that happens sends back ICMP time exceeded: Windows shows Reply from X: TTL expired in transit., Linux From X icmp_seq=1 Time to live exceeded, and an IOS ping shows & (packet lifetime exceeded). traceroute shows the same addresses taking turns. Static routes have no loop prevention, so check where each router sends the prefix with show ip route.",
  }),
  lab({
    id: "show-arp", module: M, title: "The ARP cache: show ip arp",
    cmds: ["show ip arp", "show arp", "ping"],
    devices: line(), links,
    intro: "Find out what R1 has learned at layer 2 when it sends traffic towards PC3.",
    tasks: [
      { text: "Ping 10.3.3.10 from R1, then run show ip arp on R1.", check: (t) => need(t.ran("R1", /^ping 10\.3\.3\.10/) && t.ran("R1", /^sh(ow?)? (ip )?arp/), "ping first: R1 resolves its next hop on the way.") },
      { text: "Which MAC address does R1 list for 10.0.12.2?", ask: "MAC", check: (t) => need(is.mac(t.reply, t.dev("R2").mac), "The Hardware Addr column of the 10.0.12.2 line: R2's MAC.") },
      { text: "What does a dash in the Age column mean?", choices: ["The address is R1's own", "The entry has expired", "The entry was configured statically on the PC", "The neighbor is down"], check: (t) => need(t.reply === "The address is R1's own", "R1's own interface addresses show age -.") },
      { text: "Which address does R1 have to resolve to send PC1's packet towards 10.3.3.10?", ask: "Address", check: (t) => need(is.ip(t.reply, "10.0.12.2"), "A router ARPs for the next hop, not for the final destination: R2's 10.0.12.2.") },
    ],
    solution: { R1: ["enable", "ping 10.3.3.10", "show ip arp"] },
    answers: { 1: "0001.42a3.2467", 2: "The address is R1's own", 3: "10.0.12.2" },
    teach: "A router keeps an ARP entry for each neighbor it talks to on Ethernet: hosts that ARPed for it, and the next hops it forwards to (never a remote destination). Its own addresses are listed with age -. show ip arp and show arp print the same table; clear arp-cache empties it.",
  }),
  lab({
    id: "duplex-mismatch", module: M, title: "Sim: errors on the uplink (duplex and speed)", kind: "sim",
    cmds: ["show interfaces", "show interfaces status", "show interfaces counters errors", "clear counters", "speed", "duplex"],
    devices: [
      S("SW1", 50, 22, cfg("interface fa0/24", "speed 100", "duplex full", "interface g0/1", "speed 100", "duplex full")),
      S("SW2", 20, 22),
      S("SW3", 80, 22, cfg("interface g0/1", "speed 10", "duplex full")),
      HOST("PC1", 50, 60, "windows", { ip: "10.10.10.11/24", mac: "0050.7966.1101" }),
      HOST("PC2", 20, 60, "linux", { ip: "10.10.10.12/24", mac: "0050.7966.1102" }),
      HOST("PC3", 80, 60, "linux", { ip: "10.10.10.13/24", mac: "0050.7966.1103" }),
    ],
    links: [["SW1", "fa0/24", "SW2", "fa0/24"], ["SW1", "g0/1", "SW3", "g0/1"], ["SW1", "fa0/1", "PC1", "fa0"], ["SW2", "fa0/1", "PC2", "fa0"], ["SW3", "fa0/1", "PC3", "fa0"]],
    intro: "Users behind SW2 complain that the network is slow, and nobody behind SW3 can reach anything. Someone hard-coded speed and duplex on SW1's uplinks last week. SW2 and SW3 belong to another team: change only SW1.",
    tasks: [
      { text: "At which duplex does SW2's Fa0/24 run?", choices: ["Half, negotiated (a-half)", "Full, negotiated (a-full)", "Full, fixed", "It is down"], check: (t) => need(t.reply === "Half, negotiated (a-half)", "show interfaces status on SW2: SW1 does not negotiate, so SW2's auto port senses 100 Mb/s but has to fall back to half duplex.") },
      { text: "Which counter climbs on SW2's Fa0/24, the half-duplex end?", choices: ["Late collisions", "CRC errors and runts", "Giants", "Output drops"], check: (t) => need(t.reply === "Late collisions", "show interfaces fa0/24 on SW2: collisions and late collision. The half end sees SW1 talk while it is still sending.") },
      { text: "And on SW1's Fa0/24, the full-duplex end?", choices: ["CRC errors and runts", "Late collisions", "Giants", "Nothing: full duplex has no errors"], check: (t) => need(t.reply === "CRC errors and runts", "SW1 receives the frames SW2 cut short when it backed off: runts and CRC (FCS) errors, as input errors.") },
      { text: "Make SW1 and SW2 agree on Fa0/24 again (from SW1 only).", check: (t) => { const m = linkMode(t.dev("SW1"), t.f("SW1", "fa0/24")); return need(t.up("SW1", "fa0/24") && m && !m.mismatch, !m ? "Fa0/24 is down." : `The link still runs ${m.duplex} on SW1 and ${m.farDuplex} on SW2. Let SW1's port negotiate: no speed, no duplex.`); } },
      { text: "Clear SW1's counters, then ping PC2 from PC1: Fa0/24 must count the traffic and no input errors.", check: (t) => { const c = t.dev("SW1").ctr?.["FastEthernet0/24"]; return need(c?.cleared && c.in > 0 && c.crc === 0 && c.runts === 0, !c?.cleared ? "clear counters on SW1 (it asks to confirm)." : !c.in ? "Ping PC2 from PC1 after clearing: Fa0/24 has counted no packets yet." : "Fa0/24 still counts CRC errors: the mismatch was still there when the ping crossed. Fix it, clear again, ping again."); } },
      { text: "SW1's Gi0/1 to SW3 is down/down. Why?", choices: ["Both ends have a fixed speed, and the speeds differ", "A duplex mismatch", "SW3's port is shut down", "The cable is a crossover"], check: (t) => need(t.reply === "Both ends have a fixed speed, and the speeds differ", "show running-config interface g0/1 on both: SW1 fixed at 100, SW3 at 10. With no negotiation and different speeds the link never comes up; a duplex mismatch still comes up.") },
      { text: "Bring SW1-SW3 up, with no duplex mismatch, changing only SW1.", check: (t) => { const m = linkMode(t.dev("SW1"), t.f("SW1", "g0/1")); return need(t.f("SW3", "g0/1").speed === "10" && t.up("SW1", "g0/1") && m && !m.mismatch, !t.up("SW1", "g0/1") || !m ? "Gi0/1 is still down: SW1's speed must be 10 or auto." : m.mismatch ? `Up, but SW1 runs ${m.duplex} and SW3 ${m.farDuplex} duplex. SW3 does not negotiate (its duplex is fixed): keep SW1's duplex fixed at full.` : "Leave SW3 as it is."); } },
      { text: "At what speed does the SW1-SW3 link run now?", ask: "Mb/s", check: (t) => need(is.num(t.reply.replace(/[^0-9]/g, ""), 10), "show interfaces g0/1 on SW1: 10Mb/s, the speed SW3 is fixed at.") },
      { text: "Ping PC3 from PC1.", check: (t) => need(t.ran("PC1", /^ping .*10\.10\.10\.13/) && t.reach("PC1", "10.10.10.13"), "Once Gi0/1 is up, PC1 reaches PC3 (10.10.10.13).") },
    ],
    solution: {
      SW2: ["enable", "show interfaces status", "show interfaces fa0/24"],
      SW1: ["enable", "show interfaces fa0/24", "show running-config interface g0/1", "configure terminal", "interface fa0/24", "no speed", "no duplex", "interface g0/1", "speed 10", "end", "clear counters", ""],
      PC1: ["ping 10.10.10.12", "ping 10.10.10.13"],
      "SW1#2": ["show interfaces counters errors", "show interfaces g0/1"],
    },
    answers: { 0: "Half, negotiated (a-half)", 1: "Late collisions", 2: "CRC errors and runts", 5: "Both ends have a fixed speed, and the speeds differ", 7: "10" },
    teach: "Autonegotiation needs both ends. When one end has its duplex fixed it stops negotiating; the auto end still senses the speed but has to guess the duplex, and guesses half at 10/100 Mb/s (full at 1000). The link comes up with a duplex mismatch: the half end counts collisions and late collisions, the full end runts and CRC errors, and throughput collapses under load (a ping may still work). Two fixed speeds that differ keep the link down. Fix by letting both ends negotiate, or fixing both the same. clear counters (it asks to confirm) zeroes show interfaces, so you can see whether errors still climb.",
  }),
];
