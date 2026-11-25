// Every lab, in the order the menu shows them, and the modules they sit in.
import basics from "./basics.js?v=3dfd44e";
import switching from "./switching.js?v=3dfd44e";
import stp from "./stp.js?v=3dfd44e";
import etherchannel from "./etherchannel.js?v=3dfd44e";
import routing from "./routing.js?v=3dfd44e";
import ospf from "./ospf.js?v=3dfd44e";
import intervlan from "./intervlan.js?v=3dfd44e";
import services from "./services.js?v=3dfd44e";
import hsrp from "./hsrp.js?v=3dfd44e";
import nat from "./nat.js?v=3dfd44e";
import acl from "./acl.js?v=3dfd44e";
import security from "./security.js?v=3dfd44e";
import ipv6 from "./ipv6.js?v=3dfd44e";
import management from "./management.js?v=3dfd44e";
import legacy from "./legacy.js?v=3dfd44e";
import troubleshooting from "./troubleshooting.js?v=3dfd44e";
import hostos from "./hostos.js?v=3dfd44e";
import challenge from "./challenge.js?v=3dfd44e";
import exhibits from "./exhibits.js?v=3dfd44e";

export const MODULES = [
  { id: "basics", title: "IOS basics", blurb: "modes, hostname, passwords, interfaces, saving" },
  { id: "switching", title: "VLANs and trunks", blurb: "VLANs, access, voice, trunk, native, DTP" },
  { id: "stp", title: "Spanning Tree", blurb: "Rapid PVST+, root bridge, PortFast, BPDU Guard" },
  { id: "etherchannel", title: "EtherChannel", blurb: "LACP, PAgP, static, L3 EtherChannel" },
  { id: "intervlan", title: "Inter-VLAN routing", blurb: "router on a stick, SVIs, routed ports" },
  { id: "routing", title: "Static routing", blurb: "next hop, default, floating, host, summary, Null0" },
  { id: "ospf", title: "OSPFv2", blurb: "network, router-id, passive, cost, DR/BDR, timers" },
  { id: "troubleshooting", title: "Connectivity troubleshooting", blurb: "ping, extended ping, traceroute, debug, routing loops" },
  { id: "hsrp", title: "HSRP (FHRP)", blurb: "virtual gateway, priority, preempt, version 2" },
  { id: "services", title: "IP services", blurb: "DHCP, relay, NTP, syslog, SNMP, CDP, LLDP" },
  { id: "nat", title: "NAT / PAT", blurb: "static, dynamic, overload, port forwarding" },
  { id: "acl", title: "ACLs", blurb: "standard, extended, named, wildcards, vty, sequence" },
  { id: "security", title: "Security", blurb: "SSH, local users, port security, DHCP snooping, DAI" },
  { id: "ipv6", title: "IPv6", blurb: "addressing, EUI-64, link-local, SLAAC, static routes" },
  { id: "management", title: "Device management", blurb: "IOS image, boot system, config-register, TFTP" },
  { id: "hostos", title: "Host OS commands", blurb: "Windows, Linux and macOS: ipconfig, ip addr, ifconfig, ARP, DNS" },
  { id: "exhibits", title: "Exhibit questions", blurb: "subnetting, IPv6, wireless, security, automation, virtualization, cabling: read the exhibit and answer" },
  { id: "challenge", title: "Challenge labs", blurb: "harder sims: bigger topologies, several topics, faults and questions" },
  { id: "legacy", title: "Legacy (not on 200-301)", blurb: "RIP, EIGRP, VTP" },
];

export const LABS = [...basics, ...switching, ...stp, ...etherchannel, ...intervlan, ...routing, ...ospf, ...troubleshooting, ...hsrp, ...services, ...nat, ...acl, ...security, ...ipv6, ...management, ...hostos, ...exhibits, ...challenge, ...legacy];
