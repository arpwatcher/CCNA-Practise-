import { lab, need, is } from "./kit.js";

// Blueprint topics the exam asks about from an exhibit rather than a CLI:
// automation and data formats, REST, wireless, QoS. No devices, just the
// exhibit and the questions.
const M = "exhibits";
const ex = (def) => lab({ module: M, devices: [], links: [], solution: {}, ...def });
const pick = (want, hint) => (t) => need(t.reply === want, hint);

export default [
  ex({
    id: "ex-json", title: "Reading JSON from RESTCONF",
    cmds: ["JSON", "RESTCONF", "YANG"],
    intro: "A RESTCONF GET for one interface on R1 returned this body.",
    exhibit: `{
  "ietf-interfaces:interface": {
    "name": "GigabitEthernet0/1",
    "description": "to R2",
    "type": "iana-if-type:ethernetCsmacd",
    "enabled": true,
    "ietf-ip:ipv4": {
      "address": [
        {
          "ip": "10.0.12.1",
          "netmask": "255.255.255.252"
        }
      ]
    }
  }
}`,
    tasks: [
      { text: "What JSON type is the value of \"enabled\"?", choices: ["boolean", "string", "number", "object"], check: pick("boolean", "true without quotes is a boolean; \"true\" in quotes would be a string.") },
      { text: "What JSON type is the value of \"address\"?", choices: ["array", "object", "string", "boolean"], check: pick("array", "Square brackets hold an array (an ordered list); here a list of one object.") },
      { text: "How many JSON objects are in the body, counting the outermost one?", ask: "Number", check: (t) => need(is.num(t.reply, 4), "Count the pairs of curly braces: the body, the interface, ipv4, and the one address.") },
      { text: "What prefix length does that address and netmask give?", ask: "/n", check: (t) => need(is.prefix(t.reply, 30), "255.255.255.252 has 30 bits set.") },
      { text: "Which YANG module defines the \"ipv4\" container in this body?", choices: ["ietf-ip", "ietf-interfaces", "iana-if-type", "openconfig-interfaces"], check: pick("ietf-ip", "A key prefixed with module:name comes from that module.") },
    ],
    answers: { 0: "boolean", 1: "array", 2: "4", 3: "30", 4: "ietf-ip" },
    teach: "JSON values are strings (in double quotes), numbers, booleans (true, false), null, objects ({ } with key: value pairs) and arrays ([ ] lists). Keys are always strings. RESTCONF returns YANG-modelled data as JSON or XML, and a key such as ietf-ip:ipv4 names the YANG module it comes from.",
  }),
  ex({
    id: "ex-rest", title: "A REST call and its answer",
    cmds: ["REST", "HTTP", "CRUD"],
    intro: "A script talks to the RESTCONF API on R1. These are two requests and the answers they got.",
    exhibit: `GET /restconf/data/ietf-interfaces:interfaces/interface=GigabitEthernet0%2F2 HTTP/1.1
Host: 10.0.0.1
Accept: application/yang-data+json
Authorization: Basic YWRtaW46Q2lzY28xMjM=

HTTP/1.1 404 Not Found

PUT /restconf/data/ietf-interfaces:interfaces/interface=GigabitEthernet0%2F2 HTTP/1.1
Host: 10.0.0.1
Content-Type: application/yang-data+json
Authorization: Basic YWRtaW46Q2lzY28xMjM=

{ "ietf-interfaces:interface": { "name": "GigabitEthernet0/2", "enabled": true } }

HTTP/1.1 201 Created`,
    tasks: [
      { text: "Which CRUD operation does the first request perform?", choices: ["Read", "Create", "Update", "Delete"], check: pick("Read", "GET reads; POST creates; PUT and PATCH update or replace; DELETE deletes.") },
      { text: "What does the answer to the first request say?", choices: ["The resource does not exist", "The credentials were refused", "The request was malformed", "The server failed"], check: pick("The resource does not exist", "404 is Not Found. 401 would be bad credentials, 400 a bad request, 500 a server error.") },
      { text: "Which username does the Authorization header carry? (Basic is Base64 of user:password)", ask: "Username", check: (t) => need(is.text(t.reply, "admin"), "YWRtaW46Q2lzY28xMjM= decodes to admin:Cisco123: Basic authentication is encoding, not encryption, so it needs HTTPS.") },
      { text: "In which data format does the script ask for the answer?", choices: ["JSON", "XML", "YAML", "CSV"], check: pick("JSON", "Accept: application/yang-data+json asks for YANG data encoded as JSON.") },
      { text: "Which status class does 201 Created belong to?", choices: ["2xx success", "3xx redirection", "4xx client error", "5xx server error"], check: pick("2xx success", "1xx informational, 2xx success, 3xx redirection, 4xx client error, 5xx server error.") },
    ],
    answers: { 0: "Read", 1: "The resource does not exist", 2: "admin", 3: "JSON", 4: "2xx success" },
    teach: "REST maps CRUD onto HTTP: POST creates, GET reads, PUT replaces, PATCH updates part of a resource, DELETE deletes. The status code says what happened (200 OK, 201 Created, 204 No Content, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 500 Internal Server Error). Accept says which format the client wants back, Content-Type which format it is sending.",
  }),
  ex({
    id: "ex-ansible", title: "An Ansible playbook",
    cmds: ["Ansible", "YAML", "Puppet", "Chef"],
    intro: "The operations team pushes NTP to every router with this playbook.",
    exhibit: `---
- name: set ntp on the routers
  hosts: routers
  gather_facts: no
  connection: network_cli

  tasks:
    - name: ntp server
      cisco.ios.ios_config:
        lines:
          - ntp server 10.30.30.5
          - ntp update-calendar`,
    tasks: [
      { text: "In which language is a playbook written?", choices: ["YAML", "JSON", "Ruby", "Python"], check: pick("YAML", "Ansible playbooks are YAML; Puppet manifests use Puppet's own DSL, Chef recipes Ruby.") },
      { text: "How does Ansible reach the routers?", choices: ["Agentless, over SSH, pushing from the control node", "With an agent on each router that pulls its configuration", "Over SNMP traps", "Over NETCONF only, with an agent"], check: pick("Agentless, over SSH, pushing from the control node", "Ansible needs no agent: the control node connects (here network_cli over SSH) and pushes. Puppet and Chef use agents that pull.") },
      { text: "Which inventory group does the play run against?", ask: "Group", check: (t) => need(is.text(t.reply, "routers"), "hosts: names the inventory group.") },
      { text: "How many configuration lines does the task send to each router?", ask: "Number", check: (t) => need(is.num(t.reply, 2), "The list under lines: has two entries.") },
      { text: "Which of these tools uses agents that pull their configuration from a server?", choices: ["Puppet", "Ansible", "both", "neither"], check: pick("Puppet", "Puppet (and Chef) agents pull from a master/server; Ansible pushes without agents.") },
    ],
    answers: { 0: "YAML", 1: "Agentless, over SSH, pushing from the control node", 2: "routers", 3: "2", 4: "Puppet" },
    teach: "Configuration management tools: Ansible is agentless and push-based, written in YAML playbooks and run over SSH (or NETCONF/APIs); Puppet uses agents that pull from a server, with manifests in its own language; Chef uses agents too, with recipes and cookbooks in Ruby. All of them keep many devices consistent from one definition.",
  }),
  ex({
    id: "ex-qos", title: "QoS markings in a capture",
    cmds: ["DSCP", "CoS", "LLQ"],
    intro: "Two packets captured on the uplink of an access switch, from the phone and the video endpoint in a meeting room.",
    exhibit: `Frame 118: 214 bytes on wire
Ethernet II, Src: 00:1b:54:a1:22:10, Dst: 00:50:79:66:6e:01
802.1Q Virtual LAN, PRI: 5, DEI: 0, ID: 20
Internet Protocol Version 4, Src: 10.10.20.15, Dst: 10.30.30.40
    Differentiated Services Field: 0xb8 (DSCP: EF, ECN: Not-ECT)
User Datagram Protocol, Src Port: 16384, Dst Port: 16386

Frame 119: 1110 bytes on wire
Ethernet II, Src: 00:1b:54:a1:22:31, Dst: 00:50:79:66:6e:01
802.1Q Virtual LAN, PRI: 4, DEI: 0, ID: 10
Internet Protocol Version 4, Src: 10.10.10.31, Dst: 10.30.30.41
    Differentiated Services Field: 0x88 (DSCP: AF41, ECN: Not-ECT)
User Datagram Protocol, Src Port: 5004, Dst Port: 5004`,
    tasks: [
      { text: "What decimal DSCP value does frame 118 carry?", ask: "Number", check: (t) => need(is.num(t.reply, 46), "EF is 46: the DS field 0xb8 is 184, and DSCP is its top six bits (184 / 4).") },
      { text: "What decimal DSCP value is AF41?", ask: "Number", check: (t) => need(is.num(t.reply, 34), "AFxy = 8x + 2y: 8*4 + 2*1 = 34 (and 0x88 = 136 = 34 * 4).") },
      { text: "Which traffic is frame 118 most likely?", choices: ["Voice (RTP)", "Interactive video", "Bulk data", "Network control"], check: pick("Voice (RTP)", "EF with CoS 5, small UDP packets on RTP ports: voice.") },
      { text: "Which Layer 2 field carries the CoS value 5?", choices: ["The PCP (PRI) bits of the 802.1Q tag", "The DSCP bits of the IP header", "The Ethernet type field", "The DEI bit"], check: pick("The PCP (PRI) bits of the 802.1Q tag", "CoS is the 3-bit priority (PCP) field of the 802.1Q tag, so it exists only on trunks/tagged links.") },
      { text: "Which queuing should give frame 118 a strict-priority queue with a cap on its bandwidth?", choices: ["LLQ", "WRED", "FIFO", "Policing to zero"], check: pick("LLQ", "Low Latency Queuing adds a strict priority queue (policed so it cannot starve the others) to CBWFQ.") },
      { text: "Where should the trust boundary for these markings be?", choices: ["At the access switch port facing the phone", "At the core switches", "At the WAN router only", "At the server"], check: pick("At the access switch port facing the phone", "Classify and mark (or trust a known IP phone) as close to the source as possible: the access edge.") },
    ],
    answers: { 0: "46", 1: "34", 2: "Voice (RTP)", 3: "The PCP (PRI) bits of the 802.1Q tag", 4: "LLQ", 5: "At the access switch port facing the phone" },
    teach: "DSCP is the top six bits of the IP DS field: EF (46) for voice, AF41 (34) for interactive video, CS0/default for best effort; AFxy = 8x + 2y. CoS is the 3-bit PCP field in the 802.1Q tag (5 for voice). Mark close to the source and trust only devices you control (the trust boundary); queue voice with LLQ, a policed strict-priority queue on top of CBWFQ.",
  }),
  ex({
    id: "ex-wlc", title: "A wireless LAN controller",
    cmds: ["WLC", "CAPWAP", "WPA3"],
    intro: "From the WLC that runs the office's lightweight APs.",
    exhibit: `(Cisco Controller) >show wlan summary

Number of WLANs.................................. 3

WLAN ID  WLAN Profile Name / SSID               Status    Interface Name
-------  -------------------------------------  --------  --------------------
1        CORP / CORP                            Enabled   corp
2        GUEST / GUEST                          Enabled   guest
3        LAB / LAB                              Disabled  lab

(Cisco Controller) >show wlan 1
...
Security
   802.11 Authentication:........................ Open System
   Static WEP Keys............................... Disabled
   Wi-Fi Protected Access (WPA/WPA2/WPA3)........ Enabled
      WPA3 (SAE)................................. Disabled
      WPA2 (RSN)................................. Enabled
         CCMP (AES) Cipher....................... Enabled
      Auth Key Management
         802.1x.................................. Enabled
         PSK..................................... Disabled`,
    tasks: [
      { text: "How many SSIDs do clients see?", ask: "Number", check: (t) => need(is.num(t.reply, 2), "Only the enabled WLANs are broadcast: CORP and GUEST.") },
      { text: "How does a client authenticate on CORP?", choices: ["802.1X with a RADIUS server (WPA2-Enterprise)", "A pre-shared key (WPA2-Personal)", "SAE (WPA3-Personal)", "Open, no authentication"], check: pick("802.1X with a RADIUS server (WPA2-Enterprise)", "WPA2 with 802.1x key management is Enterprise mode; PSK is Disabled.") },
      { text: "Which encryption protects CORP's traffic?", choices: ["AES (CCMP)", "TKIP", "WEP", "None"], check: pick("AES (CCMP)", "WPA2 uses CCMP, which is AES.") },
      { text: "What replaces the PSK exchange in WPA3-Personal?", choices: ["SAE", "802.1X", "TKIP", "WPS"], check: pick("SAE", "Simultaneous Authentication of Equals, resistant to offline dictionary attacks.") },
      { text: "Which protocol tunnels traffic between the lightweight APs and this WLC?", choices: ["CAPWAP", "GRE", "IPsec", "LWAPP over TCP"], check: pick("CAPWAP", "CAPWAP: UDP 5246 for control (DTLS-encrypted) and UDP 5247 for data.") },
      { text: "Each WLAN maps to an interface on the WLC. What does that interface map the SSID to?", choices: ["A VLAN on the wired network", "An AP group", "A RADIUS server", "A radio channel"], check: pick("A VLAN on the wired network", "A dynamic interface ties the WLAN to a VLAN (and subnet) on the WLC's trunk to the switch.") },
    ],
    answers: { 0: "2", 1: "802.1X with a RADIUS server (WPA2-Enterprise)", 2: "AES (CCMP)", 3: "SAE", 4: "CAPWAP", 5: "A VLAN on the wired network" },
    teach: "Lightweight APs (split MAC) tunnel to a WLC with CAPWAP, UDP 5246 control and 5247 data. Each WLAN (SSID) maps to a dynamic interface, that is a VLAN on the WLC's trunk. Personal modes use a passphrase (WPA2 PSK, WPA3 SAE), Enterprise modes 802.1X against a RADIUS server; WPA2 encrypts with AES-CCMP, WPA3 with AES-GCMP or CCMP.",
  }),  ex({
    id: "ex-tcp", title: "A TCP handshake in a capture",
    cmds: ["TCP", "UDP", "ports"],
    intro: "PC1 opens a session to a server. The first packets of the capture:",
    exhibit: `No.  Source         Destination    Protocol  Info
1    10.10.10.10    10.30.30.80    TCP       51514 > 443 [SYN] Seq=0 Win=64240 MSS=1460
2    10.30.30.80    10.10.10.10    TCP       443 > 51514 [SYN, ACK] Seq=0 Ack=1 Win=65160 MSS=1460
3    10.10.10.10    10.30.30.80    TCP       51514 > 443 [ACK] Seq=1 Ack=1 Win=64240
4    10.10.10.10    10.30.30.80    TLSv1.3   Client Hello
5    10.10.10.10    10.30.30.53    DNS       Standard query 0x5c1a A files.corp.lab
6    10.30.30.53    10.10.10.10    DNS       Standard query response 0x5c1a A files.corp.lab A 10.30.30.81`,
    tasks: [
      { text: "Which well-known service is PC1 connecting to in packets 1 to 4?", choices: ["HTTPS", "HTTP", "SSH", "DNS"], check: pick("HTTPS", "Destination port 443 is HTTPS (HTTP over TLS), and packet 4 is the TLS Client Hello.") },
      { text: "Which packet completes the three-way handshake?", ask: "Packet number", check: (t) => need(is.num(t.reply, 3), "SYN, SYN-ACK, ACK: the third packet, PC1's ACK.") },
      { text: "What is PC1's source port, picked from the ephemeral range?", ask: "Port", check: (t) => need(is.num(t.reply, 51514), "The client's port is the one that is not well known: 51514 > 443.") },
      { text: "Which transport protocol carries the DNS query in packet 5?", choices: ["UDP", "TCP", "ICMP", "TLS"], check: pick("UDP", "DNS queries go over UDP 53 (TCP 53 for zone transfers and large answers); no handshake comes before them.") },
      { text: "What does the MSS of 1460 in packet 1 tell the server?", choices: ["The largest TCP payload PC1 accepts in one segment", "The size of PC1's receive window", "The Ethernet MTU", "How many segments PC1 sends before an ACK"], check: pick("The largest TCP payload PC1 accepts in one segment", "MSS is the maximum segment payload: a 1500-byte MTU less 20 bytes of IP and 20 of TCP header. The window (Win) is the flow control.") },
    ],
    answers: { 0: "HTTPS", 1: "3", 2: "51514", 3: "UDP", 4: "The largest TCP payload PC1 accepts in one segment" },
    teach: "TCP is connection-oriented: a three-way handshake (SYN, SYN-ACK, ACK), sequence numbers and acknowledgements, windowing for flow control, retransmission. UDP sends without any of that (DNS queries, DHCP, TFTP, SNMP, syslog, voice RTP). A client uses an ephemeral source port (49152-65535 on modern systems) towards a well-known server port: 22 SSH, 23 Telnet, 25 SMTP, 53 DNS, 67/68 DHCP, 69 TFTP, 80 HTTP, 123 NTP, 161 SNMP, 443 HTTPS, 514 syslog.",
  }),
  ex({
    id: "ex-sdn", title: "A controller's northbound API",
    cmds: ["SDN", "Catalyst Center", "REST API"],
    intro: "A script asks the network controller (Catalyst Center, formerly DNA Center) for its device inventory, and gets this answer.",
    exhibit: `GET https://10.0.0.50/dna/intent/api/v1/network-device
X-Auth-Token: eyJ0eXAiOiJKV1QiLCJhbGciOi...

200 OK
{
  "response": [
    { "hostname": "core-sw1", "managementIpAddress": "10.0.0.11",
      "platformId": "C9300-48P", "softwareVersion": "17.9.4",
      "reachabilityStatus": "Reachable", "role": "DISTRIBUTION" },
    { "hostname": "edge-r1", "managementIpAddress": "10.0.0.1",
      "platformId": "ISR4331", "softwareVersion": "17.6.5",
      "reachabilityStatus": "Unreachable", "role": "BORDER ROUTER" }
  ],
  "version": "1.0"
}`,
    tasks: [
      { text: "Is this call on the controller's northbound or southbound interface?", choices: ["Northbound: an application talking to the controller", "Southbound: the controller talking to the devices", "Eastbound", "Neither: it goes straight to the devices"], check: pick("Northbound: an application talking to the controller", "Applications and scripts use the northbound API (here REST); the controller manages devices over southbound APIs (NETCONF, SSH, SNMP, OpenFlow).") },
      { text: "How does the request prove who sends it?", choices: ["A token obtained from the controller earlier", "Basic authentication on every call", "A client certificate", "It does not"], check: pick("A token obtained from the controller earlier", "X-Auth-Token carries the token the script got by authenticating once (POST to the auth endpoint).") },
      { text: "How many devices does the controller list as unreachable?", ask: "Number", check: (t) => need(is.num(t.reply, 1), "reachabilityStatus is Unreachable for edge-r1 only.") },
      { text: "Which of these would the controller use as a southbound protocol to configure a device?", choices: ["NETCONF", "REST from the script", "HTTP GET", "JSON"], check: pick("NETCONF", "NETCONF (or RESTCONF, SSH CLI, SNMP) is southbound; JSON is a data format, not a protocol.") },
      { text: "In a controller-based network, which plane does the controller centralise?", choices: ["The control plane (and management)", "The data plane", "The forwarding hardware", "The physical layer"], check: pick("The control plane (and management)", "Devices keep forwarding (data plane); the controller takes over decisions and management.") },
    ],
    answers: { 0: "Northbound: an application talking to the controller", 1: "A token obtained from the controller earlier", 2: "1", 3: "NETCONF", 4: "The control plane (and management)" },
    teach: "Software-defined networking separates the control plane from the data plane and centralises it in a controller. Applications reach the controller through northbound APIs (usually REST with JSON); the controller reaches devices through southbound ones (NETCONF, RESTCONF, OpenFlow, SSH, SNMP). In SD-Access the underlay is the routed physical network and the overlay the VXLAN fabric built on it.",
  }),
  ex({
    id: "ex-security", title: "Reading an authentication log",
    cmds: ["AAA", "RADIUS", "TACACS+"],
    intro: "The syslog server collected these lines from R1 overnight.",
    exhibit: `Mar  3 02:11:04 R1: %SEC_LOGIN-4-LOGIN_FAILED: Login failed [user: admin] [Source: 203.0.113.77] [localport: 22] [Reason: Login Authentication Failed] at 02:11:04 UTC Tue Mar 3 2026
Mar  3 02:11:05 R1: %SEC_LOGIN-4-LOGIN_FAILED: Login failed [user: root] [Source: 203.0.113.77] [localport: 22] [Reason: Login Authentication Failed] at 02:11:05 UTC Tue Mar 3 2026
Mar  3 02:11:06 R1: %SEC_LOGIN-4-LOGIN_FAILED: Login failed [user: cisco] [Source: 203.0.113.77] [localport: 22] [Reason: Login Authentication Failed] at 02:11:06 UTC Tue Mar 3 2026
Mar  3 02:11:06 R1: %SEC_LOGIN-1-QUIET_MODE_ON: Still timeleft for watching failures is 54 secs, [user: cisco] [Source: 203.0.113.77] [localport: 22] [Reason: Login Authentication Failed] [ACL: sl_def_acl] at 02:11:06 UTC Tue Mar 3 2026
Mar  3 07:58:40 R1: %SEC_LOGIN-5-LOGIN_SUCCESS: Login Success [user: netops] [Source: 10.0.99.20] [localport: 22] at 07:58:40 UTC Tue Mar 3 2026`,
    tasks: [
      { text: "What kind of attack do the first lines show?", choices: ["A password-guessing (brute-force) attack on SSH", "A DHCP starvation attack", "An ARP spoofing attack", "A phishing attack"], check: pick("A password-guessing (brute-force) attack on SSH", "Failed logins for common user names, a second apart, from one outside address, on port 22.") },
      { text: "Which feature put R1 into quiet mode?", choices: ["login block-for", "port security", "access-class", "ip ssh time-out"], check: pick("login block-for", "login block-for <s> attempts <n> within <s> blocks logins (quiet mode) after too many failures.") },
      { text: "Which severity level is the QUIET_MODE_ON message?", ask: "Level", check: (t) => need(is.num(t.reply, 1), "The digit after the facility: SEC_LOGIN-1 is level 1, alerts.") },
      { text: "With central AAA, which protocol encrypts the whole body of the packet and separates authentication, authorization and accounting?", choices: ["TACACS+", "RADIUS", "SNMPv2c", "Syslog"], check: pick("TACACS+", "TACACS+ (TCP 49) encrypts the whole payload and keeps A, A and A separate; RADIUS (UDP 1812/1813) encrypts only the password and combines authentication and authorization.") },
      { text: "Which of these would stop the attempts from ever reaching the SSH service?", choices: ["An access-class on the vty lines permitting only the management subnet", "A longer exec-timeout", "service password-encryption", "A banner motd"], check: pick("An access-class on the vty lines permitting only the management subnet", "access-class filters who may open a session at all; the attacker at 203.0.113.77 would be refused.") },
    ],
    answers: { 0: "A password-guessing (brute-force) attack on SSH", 1: "login block-for", 2: "1", 3: "TACACS+", 4: "An access-class on the vty lines permitting only the management subnet" },
    teach: "Syslog messages read %FACILITY-SEVERITY-MNEMONIC: severity 0 emergencies, 1 alerts, 2 critical, 3 errors, 4 warnings, 5 notifications, 6 informational, 7 debugging. login block-for stops password guessing for a while after repeated failures; an access-class on the vty lines decides who may connect at all. AAA centralises logins: TACACS+ (TCP 49, whole payload encrypted, AAA separated, common for device admin) or RADIUS (UDP 1812/1813, password only encrypted, common for network access such as 802.1X).",
  }),
  ex({
    id: "ex-ping-results", title: "Reading ping results",
    cmds: ["ping", "!", ".", "U", "Request timed out"],
    intro: "Five pings, run one after another from the devices named. Each tells a different story.",
    exhibit: `(A) R1#ping 10.0.23.2
Sending 5, 100-byte ICMP Echos to 10.0.23.2, timeout is 2 seconds:
.!!!!
Success rate is 80 percent (4/5), round-trip min/avg/max = 1/2/4 ms

(B) R1#ping 10.0.23.2
Sending 5, 100-byte ICMP Echos to 10.0.23.2, timeout is 2 seconds:
!!!!!
Success rate is 100 percent (5/5), round-trip min/avg/max = 1/1/4 ms

(C) R1#ping 10.9.9.9
Sending 5, 100-byte ICMP Echos to 10.9.9.9, timeout is 2 seconds:
U.U.U
Success rate is 0 percent (0/5)

(D) R1#ping 10.0.12.99
Sending 5, 100-byte ICMP Echos to 10.0.12.99, timeout is 2 seconds:
.....
Success rate is 0 percent (0/5)

(E) C:\\Users\\student>ping 10.3.3.10
Pinging 10.3.3.10 with 32 bytes of data:
Reply from 10.1.1.10: Destination host unreachable.
Reply from 10.1.1.10: Destination host unreachable.
Reply from 10.1.1.10: Destination host unreachable.
Reply from 10.1.1.10: Destination host unreachable.

Ping statistics for 10.3.3.10:
    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),`,
    tasks: [
      { text: "Why did the first echo in (A) fail, but none in (B)?", choices: ["R1 had to ARP for the next hop first; by (B) the entry was cached", "The link was congested for two seconds", "An ACL dropped the first packet", "The far router was still booting"], check: pick("R1 had to ARP for the next hop first; by (B) the entry was cached", "A router drops the packet that triggers an ARP request; the next pings find the MAC in the ARP cache.") },
      { text: "What does each U in (C) mean?", choices: ["A router sent back ICMP destination unreachable", "The echo timed out", "An unknown packet type came back", "The reply was received out of order"], check: pick("A router sent back ICMP destination unreachable", "U is an unreachable answer (no route, or an ACL); the dots between are rate-limiting of those answers.") },
      { text: "In (D), 10.0.12.99 is on R1's own connected subnet. What is the most likely cause?", choices: ["No device owns 10.0.12.99, so R1's ARP goes unanswered", "R1 has no route to 10.0.12.0/24", "An ACL on R1 blocks ICMP", "The ping needs a source address"], check: pick("No device owns 10.0.12.99, so R1's ARP goes unanswered", "Five dots, no U: nobody answers at all. show ip arp lists 10.0.12.99 as Incomplete.") },
      { text: "In (E), who wrote Destination host unreachable?", choices: ["The PC itself (10.1.1.10): its ARP for the next hop got no answer", "The router at 10.3.3.1", "The target 10.3.3.10", "A switch on the way"], check: pick("The PC itself (10.1.1.10): its ARP for the next hop got no answer", "The reply comes from the PC's own address: it could not resolve its gateway (or the target on its own subnet), so it reports the failure itself.") },
      { text: "Windows printed Received = 4, Lost = 0 in (E). How many echo replies came back from 10.3.3.10?", ask: "Replies", check: (t) => need(is.num(t.reply, 0), "None: Windows counts the unreachable messages as received. Read the lines, not the totals.") },
      { text: "Which of these would a Windows PC show for a first echo lost at a router that had to ARP?", choices: ["Request timed out. on the first line, then replies", "Destination host unreachable. on every line", "General failure.", "TTL expired in transit."], check: pick("Request timed out. on the first line, then replies", "The router drops the first echo while it ARPs, so the PC times out once and gets the other replies: Received = 3, Lost = 1.") },
    ],
    answers: { 0: "R1 had to ARP for the next hop first; by (B) the entry was cached", 1: "A router sent back ICMP destination unreachable", 2: "No device owns 10.0.12.99, so R1's ARP goes unanswered", 3: "The PC itself (10.1.1.10): its ARP for the next hop got no answer", 4: "0", 5: "Request timed out. on the first line, then replies" },
    teach: "IOS ping marks each echo: ! a reply, . a timeout, U a destination unreachable, Q source quench, M could not fragment, ? unknown, & TTL expired. A leading . is usually the router's own ARP for the next hop. Five dots on a connected subnet means nobody answered the ARP; U means a router answered no route or an ACL. On Windows, Destination host unreachable from the PC's own address means its ARP failed, and Windows counts those lines as received.",
  }),
  ex({
    id: "ex-syslog-levels", title: "Syslog severity levels",
    cmds: ["logging trap", "show logging"],
    intro: "R1 sends its log to a syslog server with logging host 10.1.1.50 and logging trap warnings. These messages were in its buffer this morning.",
    exhibit: `*Mar  1 09:14:02.113: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down
*Mar  1 09:14:03.113: %LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/1, changed state to down
*Mar  1 09:15:40.871: %SYS-5-CONFIG_I: Configured from console by admin on vty0 (10.1.1.10)
*Mar  1 09:16:12.004: %OSPF-5-ADJCHG: Process 1, Nbr 2.2.2.2 on GigabitEthernet0/1 from FULL to DOWN, Neighbor Down: Interface down or detached
*Mar  1 09:20:55.430: %SEC_LOGIN-4-LOGIN_FAILED: Login failed [user: admin] [Source: 10.9.9.9] [localport: 22] [Reason: Login Authentication Failed]
*Mar  1 09:21:00.002: %SYS-2-MALLOCFAIL: Memory allocation of 65536 bytes failed`,
    tasks: [
      { text: "What severity is the %LINK-3-UPDOWN message?", choices: ["errors", "warnings", "critical", "notifications"], check: pick("errors", "The number in %FACILITY-n-MNEMONIC is the severity: 3 is errors.") },
      { text: "Which message is the most severe?", choices: ["%SYS-2-MALLOCFAIL", "%LINK-3-UPDOWN", "%SEC_LOGIN-4-LOGIN_FAILED", "%OSPF-5-ADJCHG"], check: pick("%SYS-2-MALLOCFAIL", "The lower the number, the more severe: 2 (critical) beats 3, 4 and 5.") },
      { text: "With logging trap warnings, how many of these six messages reach the syslog server?", ask: "Number", check: (t) => need(is.num(t.reply, 3), "warnings is level 4: levels 0 to 4 are sent (the 3, the 4 and the 2), the three level-5 messages are not.") },
      { text: "What is the name of level 5?", choices: ["notifications", "informational", "warnings", "debugging"], check: pick("notifications", "0 emergencies, 1 alerts, 2 critical, 3 errors, 4 warnings, 5 notifications, 6 informational, 7 debugging.") },
      { text: "What does the * in front of each time stamp mean?", choices: ["The clock is not authoritative: it was never set or synced by NTP", "The message was sent to the syslog server", "The message repeated several times", "The time is in UTC"], check: pick("The clock is not authoritative: it was never set or synced by NTP", "IOS puts * before the time while the clock is not set by hand or synchronised by NTP; show clock shows it too.") },
    ],
    answers: { 0: "errors", 1: "%SYS-2-MALLOCFAIL", 2: "3", 3: "notifications", 4: "The clock is not authoritative: it was never set or synced by NTP" },
    teach: "Syslog levels: 0 emergencies, 1 alerts, 2 critical, 3 errors, 4 warnings, 5 notifications, 6 informational, 7 debugging (\"Every Awesome Cisco Engineer Will Need Ice cream Daily\"). logging trap <level> sends that level and every more severe one (lower number) to the server; logging console and logging buffered work the same way for their destination.",
  }),
  ex({
    id: "ex-wifi-channels", title: "2.4 GHz channels in a site survey",
    cmds: ["2.4 GHz", "5 GHz", "RSSI"],
    intro: "A site survey of the office measured these access points from one desk.",
    exhibit: `AP         Band      Channel  Width   RSSI at desk
---------  --------  -------  ------  ------------
AP-Lobby   2.4 GHz   1        20 MHz  -48 dBm
AP-Sales   2.4 GHz   6        20 MHz  -61 dBm
AP-Ops     2.4 GHz   4        20 MHz  -63 dBm
AP-Lab     5 GHz     36       40 MHz  -55 dBm`,
    tasks: [
      { text: "Which access point is on a 2.4 GHz channel that overlaps the others?", choices: ["AP-Ops", "AP-Lobby", "AP-Sales", "AP-Lab"], check: pick("AP-Ops", "2.4 GHz channels are 5 MHz apart but about 22 MHz wide: channel 4 overlaps both 1 and 6.") },
      { text: "Which channel should it move to?", ask: "Channel", check: (t) => need(is.num(t.reply, 11), "1, 6 and 11 are the three non-overlapping 2.4 GHz channels; 1 and 6 are taken.") },
      { text: "Which access point has the strongest signal at the desk?", choices: ["AP-Lobby", "AP-Sales", "AP-Ops", "AP-Lab"], check: pick("AP-Lobby", "RSSI is in negative dBm: the closer to 0, the stronger. -48 is stronger than -55, -61 or -63.") },
      { text: "Why does 5 GHz rarely have this problem?", choices: ["It has far more spectrum, so many channels fit side by side without overlapping", "5 GHz signals go through walls better", "5 GHz access points share one channel by design", "5 GHz uses 22 MHz channels"], check: pick("It has far more spectrum, so many channels fit side by side without overlapping", "5 GHz has over 20 non-overlapping 20 MHz channels; the trade-off is a shorter range than 2.4 GHz.") },
    ],
    answers: { 0: "AP-Ops", 1: "11", 2: "AP-Lobby", 3: "It has far more spectrum, so many channels fit side by side without overlapping" },
    teach: "In 2.4 GHz only channels 1, 6 and 11 do not overlap, so neighbouring access points use those three. RSSI is measured in dBm and is negative: -30 is excellent, -67 is the usual minimum for voice, -80 is poor. 5 GHz has many more non-overlapping channels (36, 40, 44, 48 and up) and wider channel options, but a shorter range.",
  }),
  ex({
    id: "ex-ipv6-types", title: "IPv6 address types on an interface",
    cmds: ["show ipv6 interface"],
    intro: "show ipv6 interface on R1, a router with ipv6 unicast-routing.",
    exhibit: `R1#show ipv6 interface GigabitEthernet0/0
GigabitEthernet0/0 is up, line protocol is up
  IPv6 is enabled, link-local address is FE80::1
  No Virtual link-local address(es):
  Global unicast address(es):
    2001:DB8:ACAD:10::1, subnet is 2001:DB8:ACAD:10::/64
  Joined group address(es):
    FF02::1
    FF02::2
    FF02::1:FF00:1
  MTU is 1500 bytes
  ICMP error messages limited to one every 100 milliseconds
  ND reachable time is 30000 milliseconds (using 30000)`,
    tasks: [
      { text: "What kind of address is FE80::1?", choices: ["link-local", "global unicast", "unique local", "multicast"], check: pick("link-local", "FE80::/10 is link-local: valid only on this link, used for neighbor discovery and as the next hop in routing.") },
      { text: "Which group does R1 join only because it routes IPv6?", choices: ["FF02::2", "FF02::1", "FF02::1:FF00:1", "FE80::1"], check: pick("FF02::2", "FF02::2 is all-routers; every IPv6 node joins FF02::1 (all-nodes).") },
      { text: "What is FF02::1:FF00:1 for?", choices: ["Solicited-node multicast: neighbor discovery uses it instead of ARP", "All OSPFv3 routers", "The anycast address of the subnet", "DHCPv6 servers"], check: pick("Solicited-node multicast: neighbor discovery uses it instead of ARP", "FF02::1:FF plus the last 24 bits of each unicast address: a neighbor solicitation for ::1 goes only to nodes whose addresses end that way.") },
      { text: "What type is an address such as FD12:3456:789A::10?", choices: ["unique local", "global unicast", "link-local", "multicast"], check: pick("unique local", "FC00::/7 (in practice FD00::/8) is unique local: private addressing, not routed on the Internet.") },
      { text: "With a /64, which part of 2001:DB8:ACAD:10::1 is the interface ID?", choices: ["::1 (the last 64 bits)", "2001:DB8 (the first 32 bits)", "ACAD:10 (bits 33 to 64)", "the whole address"], check: pick("::1 (the last 64 bits)", "A /64 leaves 64 bits for the interface ID: 0000:0000:0000:0001 here.") },
    ],
    answers: { 0: "link-local", 1: "FF02::2", 2: "Solicited-node multicast: neighbor discovery uses it instead of ARP", 3: "unique local", 4: "::1 (the last 64 bits)" },
    teach: "IPv6 address types: global unicast 2000::/3, unique local FC00::/7, link-local FE80::/10, multicast FF00::/8 (FF02::1 all nodes, FF02::2 all routers, FF02::1:FFxx:xxxx solicited-node), loopback ::1, unspecified ::. 2001:DB8::/32 is reserved for documentation. An interface has a link-local address as soon as IPv6 is enabled, global ones only when configured or learned by SLAAC.",
  }),
  ex({
    id: "ex-threats", title: "Threats, vulnerabilities and mitigation",
    cmds: ["threat", "vulnerability", "exploit", "mitigation"],
    intro: "An incident report from a small company.",
    exhibit: `INCIDENT 2026-031
09:02  Staff receive an email "from IT" asking them to confirm their password
       on a look-alike login page. Two people enter theirs.
09:40  An attacker logs in to the VPN with one of those passwords.
09:55  From inside, the attacker uses a known flaw in the file server's
       unpatched SMB service to run code on it.
10:30  The file server starts encrypting shared folders.

Findings:
  - The VPN asks for a password only.
  - The file server had missed six months of updates.
  - Staff have had no security awareness training.`,
    tasks: [
      { text: "What kind of attack was the email?", choices: ["Phishing", "Denial of service", "MAC flooding", "Brute force"], check: pick("Phishing", "A fake message that tricks people into giving credentials is phishing, a form of social engineering.") },
      { text: "In this report, which item is the vulnerability?", choices: ["The unpatched SMB service on the file server", "The attacker", "The code run through the SMB flaw", "Patching the server"], check: pick("The unpatched SMB service on the file server", "A vulnerability is a weakness. The attacker is the threat, the code that uses the flaw is the exploit, patching is the mitigation.") },
      { text: "What does the code that abused the SMB flaw count as?", choices: ["An exploit", "A vulnerability", "A threat actor", "A mitigation"], check: pick("An exploit", "An exploit is the thing that takes advantage of a vulnerability.") },
      { text: "Which single change would have stopped the VPN login at 09:40?", choices: ["Multi-factor authentication on the VPN", "A longer DHCP lease", "Port security on the access switches", "A syslog server"], check: pick("Multi-factor authentication on the VPN", "With MFA a stolen password alone is not enough: the attacker would also need the second factor.") },
      { text: "Which part of a security program addresses the 09:02 step?", choices: ["User awareness training", "Physical access control", "Patch management", "Backups"], check: pick("User awareness training", "Phishing works on people; training (and phishing simulations) teach staff to spot and report it.") },
    ],
    answers: { 0: "Phishing", 1: "The unpatched SMB service on the file server", 2: "An exploit", 3: "Multi-factor authentication on the VPN", 4: "User awareness training" },
    teach: "A vulnerability is a weakness, a threat is someone or something that could use it, an exploit is what actually uses it, and a mitigation reduces the risk. Common attacks on the exam: phishing and other social engineering, malware (ransomware here), denial of service, spoofing, man-in-the-middle, password attacks. A security program combines user awareness, training and physical access control; MFA (something you know, have, are) stops stolen passwords on their own.",
  }),
  ex({
    id: "ex-vpn", title: "Site-to-site and remote-access VPNs",
    cmds: ["IPsec", "VPN"],
    intro: "The network team's notes on two VPNs.",
    exhibit: `VPN-A  Branch router BR1 <-> HQ firewall
       IPsec tunnel, always up, carries traffic between 10.20.0.0/16 and 10.1.0.0/16
       Users at the branch run no VPN software.

VPN-B  Laptops of staff working from home -> HQ firewall
       Started by the user from a client on the laptop (TLS or IPsec)
       Each laptop gets an address from 10.99.0.0/24 while connected.`,
    tasks: [
      { text: "What type of VPN is VPN-A?", choices: ["Site-to-site", "Remote access", "Clientless SSL", "GRE without encryption"], check: pick("Site-to-site", "Two networks joined by their gateways, always on, with nothing on the users' PCs: site-to-site.") },
      { text: "What type of VPN is VPN-B?", choices: ["Remote access", "Site-to-site", "DMVPN", "MPLS"], check: pick("Remote access", "One user at a time, started from a client on the device: remote access.") },
      { text: "Which of these does IPsec provide?", choices: ["Confidentiality, integrity and authentication of the packets", "Faster routing between the sites", "Name resolution across the tunnel", "Address assignment for the branch PCs"], check: pick("Confidentiality, integrity and authentication of the packets", "IPsec encrypts (confidentiality), detects changes (integrity) and checks the peer (authentication), plus anti-replay.") },
      { text: "Who encrypts the branch users' traffic on VPN-A?", choices: ["BR1, the branch router", "Each PC at the branch", "The ISP", "Nobody: site-to-site traffic is not encrypted"], check: pick("BR1, the branch router", "In a site-to-site VPN the gateways encrypt and decrypt; the hosts send plain traffic to their gateway.") },
    ],
    answers: { 0: "Site-to-site", 1: "Remote access", 2: "Confidentiality, integrity and authentication of the packets", 3: "BR1, the branch router" },
    teach: "A site-to-site VPN joins whole networks through their routers or firewalls, is usually always on, and the hosts know nothing about it. A remote-access VPN connects one device: the user starts a client (IPsec or TLS/SSL, as with Cisco Secure Client) and gets an inside address. IPsec gives confidentiality, integrity, authentication and anti-replay.",
  }),
  ex({
    id: "ex-cabling", title: "Copper and fiber for each link",
    cmds: ["UTP", "multimode", "single-mode"],
    intro: "A plan for the links in a new building.",
    exhibit: `Link  From              To                    Distance  Medium
----  ----------------  --------------------  --------  ----------------------
L1    Desk PC           Floor access switch   40 m      Cat 6 UTP
L2    Access switch     Distribution switch   250 m     ? (10 Gb/s)
L3    Distribution      Second campus site    9 km      ? (10 Gb/s)
L4    Access switch     Access switch         2 m       Cat 6 UTP, same port types`,
    tasks: [
      { text: "What is the longest a copper Ethernet run such as L1 may be?", ask: "metres", check: (t) => need(is.num(t.reply, 100), "Twisted-pair Ethernet (Cat 5e, 6, 6a) is specified to 100 metres.") },
      { text: "Which medium fits L2 best?", choices: ["Multimode fiber", "Single-mode fiber", "Cat 6 UTP", "Coaxial cable"], check: pick("Multimode fiber", "250 m is beyond copper; multimode fiber (with an LED or VCSEL light source) is the cheaper choice inside a building or campus.") },
      { text: "Which medium fits L3 best?", choices: ["Single-mode fiber", "Multimode fiber", "Cat 6a UTP", "Wireless 5 GHz"], check: pick("Single-mode fiber", "Kilometres call for single-mode fiber with a laser: its narrow core keeps the light from spreading over distance.") },
      { text: "Do the two switches on L4 need a crossover cable?", choices: ["No: Auto-MDIX on modern ports fixes the pairs", "Yes: like devices always need a crossover", "Yes, unless both run 10 Mb/s", "No, because UTP has no transmit pairs"], check: pick("No: Auto-MDIX on modern ports fixes the pairs", "Without Auto-MDIX, switch to switch needs a crossover; with it (the default today) a straight-through cable works.") },
    ],
    answers: { 0: "100", 1: "Multimode fiber", 2: "Single-mode fiber", 3: "No: Auto-MDIX on modern ports fixes the pairs" },
    teach: "Copper UTP Ethernet reaches 100 m. Multimode fiber has a wider core, uses cheaper light sources and reaches hundreds of metres at 10 Gb/s, typical inside buildings and campuses. Single-mode fiber has a narrow core and a laser and reaches kilometres. Like devices (switch-switch, PC-router) used to need a crossover cable; Auto-MDIX makes the port swap the pairs itself.",
  }),
  ex({
    id: "ex-architectures", title: "Two-tier, three-tier and spine-leaf",
    cmds: ["collapsed core", "spine-leaf"],
    intro: "Three network designs from the exam topics.",
    exhibit: `Design A: access switches -> two switches that do both distribution and core
Design B: access switches -> distribution pairs -> a separate pair of core switches
Design C: every leaf switch connects to every spine switch;
          servers connect only to leaves; spines never connect to each other`,
    tasks: [
      { text: "What is design A called?", choices: ["Two-tier (collapsed core)", "Three-tier", "Spine-leaf", "SOHO"], check: pick("Two-tier (collapsed core)", "When distribution and core are the same switches, the core is collapsed into distribution: two tiers.") },
      { text: "When does design B make sense?", choices: ["A large campus with many buildings, so a dedicated core joins the distribution blocks", "A home office with one router", "A small branch with one access switch", "Only inside a data center"], check: pick("A large campus with many buildings, so a dedicated core joins the distribution blocks", "Three tiers add a fast core so that many distribution blocks do not have to be meshed with each other.") },
      { text: "In design C, how many switches does traffic from one server to a server on another leaf cross?", ask: "Number", check: (t) => need(is.num(t.reply, 3), "Leaf, spine, leaf: always three switches, whatever the pair of servers. That predictable path is the point of spine-leaf.") },
      { text: "Where is design C used?", choices: ["Data centers, for east-west traffic between servers", "Wireless networks", "WAN links between branches", "Home networks"], check: pick("Data centers, for east-west traffic between servers", "Spine-leaf suits data centers, where most traffic goes server to server (east-west).") },
    ],
    answers: { 0: "Two-tier (collapsed core)", 1: "A large campus with many buildings, so a dedicated core joins the distribution blocks", 2: "3", 3: "Data centers, for east-west traffic between servers" },
    teach: "Two-tier (collapsed core) suits small and medium campuses. Three-tier adds a separate core to join many distribution blocks in a large campus. Spine-leaf is the data center design: every leaf connects to every spine, so any two servers are leaf-spine-leaf apart and capacity grows by adding spines. Other topologies on the exam: WAN, SOHO, on-premises and cloud.",
  }),
  ex({
    id: "ex-vlsm", title: "Subnetting with VLSM",
    cmds: ["VLSM", "subnet mask", "wildcard"],
    intro: "192.168.10.0/24 has to be split for four networks. Give the biggest one its block first, then the next, each starting where the last one ended.",
    exhibit: `Network   Hosts needed
--------  ------------
Sales     100
IT        50
Mgmt      20
WAN link  2     (R1 - R2)

Address block: 192.168.10.0/24`,
    tasks: [
      { text: "What is the longest prefix that still fits Sales (100 hosts)?", ask: "/n", check: (t) => need(is.prefix(t.reply, 25), "A /25 has 7 host bits: 2^7 - 2 = 126 hosts. A /26 has only 62.") },
      { text: "Sales takes 192.168.10.0/25. What is the network address of IT (50 hosts), the next block?", ask: "IP address", check: (t) => need(is.ip(t.reply, "192.168.10.128"), "Sales ends at .127 (its broadcast), so IT starts at .128, as a /26 (62 hosts).") },
      { text: "Mgmt (20 hosts) gets the next /27. What is its broadcast address?", ask: "IP address", check: (t) => need(is.ip(t.reply, "192.168.10.223"), "IT is .128/26, ending at .191. Mgmt is .192/27: 32 addresses, so the broadcast is .223.") },
      { text: "How many usable host addresses does a /27 have?", ask: "Number", check: (t) => need(is.num(t.reply, 30), "5 host bits: 2^5 - 2 = 30 (the network and broadcast addresses are not usable).") },
      { text: "The WAN link gets 192.168.10.224/30. What is its first usable address?", ask: "IP address", check: (t) => need(is.ip(t.reply, "192.168.10.225"), ".224 is the network, .225 and .226 the two hosts, .227 the broadcast.") },
      { text: "What wildcard mask matches the whole IT subnet in an ACL or OSPF network statement?", ask: "Wildcard", check: (t) => need(is.ip(t.reply, "0.0.0.63"), "A /26 mask is 255.255.255.192; the wildcard is 255.255.255.255 minus it: 0.0.0.63.") },
    ],
    answers: { 0: "/25", 1: "192.168.10.128", 2: "192.168.10.223", 3: "30", 4: "192.168.10.225", 5: "0.0.0.63" },
    teach: "Usable hosts = 2^(host bits) - 2. For VLSM, sort the networks from biggest to smallest and give each the smallest block that fits, starting right after the previous block, so no addresses overlap. Block sizes in the last octet: /25 = 128, /26 = 64, /27 = 32, /28 = 16, /29 = 8, /30 = 4. The wildcard mask is the inverted subnet mask.",
  }),
  ex({
    id: "ex-sd-access", title: "Underlay, overlay and Catalyst Center",
    cmds: ["SD-Access", "VXLAN", "Catalyst Center"],
    intro: "A summary of a campus moved to SD-Access, managed by Catalyst Center (formerly DNA Center).",
    exhibit: `Underlay : the physical switches and links, routed with IS-IS,
           giving reachability between every switch loopback
Overlay  : VXLAN tunnels between the edge switches carry the users' traffic,
           LISP tracks where each endpoint is
Fabric   : underlay + overlay together
Policy   : "Contractors may reach only the Internet" is entered once in
           Catalyst Center, which pushes it to every switch

Before   : each switch was configured by hand over SSH, one CLI at a time`,
    tasks: [
      { text: "Which part carries the users' traffic, in tunnels between the edge switches?", choices: ["The overlay", "The underlay", "The management plane", "The spine"], check: pick("The overlay", "The overlay is the virtual network built on top of the underlay with VXLAN tunnels.") },
      { text: "Which part must exist first, because everything else runs on it?", choices: ["The underlay", "The overlay", "The policy", "The Catalyst Center GUI"], check: pick("The underlay", "The underlay gives plain IP reachability between the switches; the tunnels of the overlay ride on it.") },
      { text: "What does Catalyst Center change compared with the \"Before\" line?", choices: ["Policy is defined once centrally and pushed to all devices", "Each switch must still be configured by hand", "It replaces the switches' data plane", "It removes the need for an underlay"], check: pick("Policy is defined once centrally and pushed to all devices", "Controller-based (intent-based) management: you describe the intent once, the controller configures every device. Traditional management is device by device.") },
      { text: "Which encapsulation builds the SD-Access overlay?", choices: ["VXLAN", "802.1Q", "GRE over IPsec", "MPLS"], check: pick("VXLAN", "SD-Access uses VXLAN for the data plane and LISP for the control plane of the overlay.") },
    ],
    answers: { 0: "The overlay", 1: "The underlay", 2: "Policy is defined once centrally and pushed to all devices", 3: "VXLAN" },
    teach: "SDN splits the network into an underlay (the physical network and its routing) and an overlay (virtual networks in tunnels over it); together they are the fabric. In Cisco SD-Access the overlay uses VXLAN and LISP, and Catalyst Center (formerly DNA Center) is the controller: it pushes policy to every device, gives assurance data and uses REST APIs northbound, unlike traditional device-by-device management.",
  }),
  ex({
    id: "ex-virtualization", title: "Virtual machines, containers and VRFs",
    cmds: ["hypervisor", "container", "VRF"],
    intro: "An inventory of where the company's workloads run.",
    exhibit: `srv-01  VMware ESXi installed directly on the server hardware
        VM web1  Ubuntu 24.04   2 vCPU   4 GB   vNIC -> vSwitch0, VLAN 10
        VM db1   Windows 2022   4 vCPU  16 GB   vNIC -> vSwitch0, VLAN 20
lap-07  Windows 11 laptop running VirtualBox, one Linux VM for labs
app-02  Linux server running Docker: 12 containers on one kernel
R1      vrf definition CUST-A and vrf definition CUST-B,
        both customers use 10.0.0.0/24 on their own interfaces`,
    tasks: [
      { text: "What type of hypervisor is ESXi on srv-01?", choices: ["Type 1 (bare metal)", "Type 2 (hosted)", "A container engine", "An emulator"], check: pick("Type 1 (bare metal)", "A type 1 hypervisor runs directly on the hardware, with no operating system under it.") },
      { text: "What type is VirtualBox on lap-07?", choices: ["Type 2 (hosted)", "Type 1 (bare metal)", "A VRF", "A container engine"], check: pick("Type 2 (hosted)", "A type 2 hypervisor runs as an application on top of an operating system (Windows here).") },
      { text: "What do the 12 containers on app-02 share that VMs do not?", choices: ["The host's operating system kernel", "Their own virtual hardware", "A separate guest OS each", "Nothing: they are VMs"], check: pick("The host's operating system kernel", "Containers package an application and its libraries but share the host kernel, so they are much lighter than VMs, which each run a whole guest OS.") },
      { text: "What connects web1 and db1 to the physical network and its VLANs?", choices: ["A virtual switch in the hypervisor", "A router on a stick inside each VM", "The containers", "VRF CUST-A"], check: pick("A virtual switch in the hypervisor", "VMs plug their vNICs into a virtual switch, which tags their VLANs and uplinks through the server's physical NICs.") },
      { text: "How can both customers use 10.0.0.0/24 on R1?", choices: ["Each VRF has its own routing table", "R1 translates one of them with NAT automatically", "The second network is ignored", "VLANs keep IP addresses apart on a router"], check: pick("Each VRF has its own routing table", "A VRF splits one router into several routing tables, so overlapping addresses in different VRFs do not clash.") },
    ],
    answers: { 0: "Type 1 (bare metal)", 1: "Type 2 (hosted)", 2: "The host's operating system kernel", 3: "A virtual switch in the hypervisor", 4: "Each VRF has its own routing table" },
    teach: "A type 1 hypervisor (ESXi, Hyper-V Server, KVM) runs on the hardware; a type 2 (VirtualBox, VMware Workstation) runs on an OS. Each VM has virtual hardware and a full guest OS; containers (Docker) share the host kernel and start in seconds. VMs reach the network through a virtual switch. VRFs (virtual routing and forwarding) give one router several separate routing tables.",
  }),
  ex({
    id: "ex-dhcp-dora", title: "A DHCP exchange in a capture",
    cmds: ["DHCP", "ip helper-address"],
    intro: "A capture on PC1's access port while it boots.",
    exhibit: `No. Source      Destination       Proto  Info
1   0.0.0.0     255.255.255.255   DHCP   DHCP Discover - Transaction ID 0x3a7c91d2
2   10.1.1.1    255.255.255.255   DHCP   DHCP Offer    - Transaction ID 0x3a7c91d2
3   0.0.0.0     255.255.255.255   DHCP   DHCP Request  - Transaction ID 0x3a7c91d2
4   10.1.1.1    255.255.255.255   DHCP   DHCP ACK      - Transaction ID 0x3a7c91d2

Packet 4, options:
  Your (client) IP address: 10.1.1.23
  Option (1)  Subnet Mask: 255.255.255.0
  Option (3)  Router: 10.1.1.1
  Option (6)  Domain Name Server: 8.8.8.8
  Option (51) IP Address Lease Time: (86400s) 1 day`,
    tasks: [
      { text: "Why is the source of the Discover 0.0.0.0?", choices: ["PC1 has no address yet", "The server hides its address", "It is a multicast", "PC1 uses APIPA"], check: pick("PC1 has no address yet", "The client sends from 0.0.0.0 to the broadcast address because it does not know its own address or the server's.") },
      { text: "Which UDP port does the DHCP server listen on?", ask: "Port", check: (t) => need(is.num(t.reply, 67), "Server UDP 67, client UDP 68.") },
      { text: "Which option tells PC1 its default gateway?", choices: ["Option 3", "Option 1", "Option 6", "Option 51"], check: pick("Option 3", "Option 3 is the router (default gateway); 1 is the mask, 6 the DNS servers, 51 the lease time.") },
      { text: "If the DHCP server were on another subnet, what would have to be set on R1's G0/0?", choices: ["ip helper-address <server>", "ip dhcp snooping", "ip nat inside", "no ip unreachables"], check: pick("ip helper-address <server>", "Broadcasts stop at the router; ip helper-address relays them as unicast to the server.") },
      { text: "When does PC1 first try to renew this lease?", choices: ["After half of it, 12 hours", "After the full day", "Every boot only", "After 1 hour"], check: pick("After half of it, 12 hours", "The client renews at 50% of the lease (T1) with the server that gave it, and tries any server at 87.5% (T2).") },
    ],
    answers: { 0: "PC1 has no address yet", 1: "67", 2: "Option 3", 3: "ip helper-address <server>", 4: "After half of it, 12 hours" },
    teach: "DHCP is DORA: Discover (client broadcast), Offer (server), Request (client broadcast, so other servers know which offer won), Acknowledge. The server listens on UDP 67, the client on 68. Option 1 is the mask, 3 the default gateway, 6 the DNS servers, 51 the lease time; the client renews at half the lease. A router relays the broadcasts to a server on another subnet with ip helper-address.",
  }),
  ex({
    id: "ex-ap-modes", title: "AP modes and WLC ports",
    cmds: ["FlexConnect", "LAG", "service port"],
    intro: "A wireless design for a company with a head office and small branches, all managed by one WLC at the head office.",
    exhibit: `Access points
  HQ-AP-01..40   at the head office, all client traffic tunnelled to the WLC
  BR-AP-01..12   at branches over the WAN; branch users' traffic must stay
                 local if the WAN to the WLC goes down
  HQ-MON-01      serves no clients, scans every channel for rogue APs

WLC (9800) ports
  Port A  -> management switch, out-of-band, used only to manage the WLC
  Ports 1-4 -> core switches, bundled into one logical link carrying all
              WLAN and management VLANs as an 802.1Q trunk
  Console  -> terminal server`,
    tasks: [
      { text: "Which mode do the HQ access points run in?", choices: ["Local", "FlexConnect", "Monitor", "Sniffer"], check: pick("Local", "Local mode is the default for lightweight APs: client traffic goes to the WLC in the CAPWAP tunnel.") },
      { text: "Which mode fits the branch access points?", choices: ["FlexConnect", "Local", "Bridge", "Sniffer"], check: pick("FlexConnect", "FlexConnect can switch client traffic locally at the branch and keep serving clients when the link to the WLC is down.") },
      { text: "Which mode is HQ-MON-01 in?", choices: ["Monitor", "Local", "SE-Connect", "Bridge"], check: pick("Monitor", "A monitor-mode AP serves no clients; it scans all channels for rogue devices and intrusion detection.") },
      { text: "What kind of WLC port is port A?", choices: ["Service port", "Distribution port", "Redundancy port", "Console port"], check: pick("Service port", "The service port is for out-of-band management only and carries no client traffic.") },
      { text: "Ports 1-4 bundled into one logical link: what is that called on a WLC?", choices: ["LAG (link aggregation)", "PortFast", "VTP", "HSRP"], check: pick("LAG (link aggregation)", "The distribution ports form a LAG, an EtherChannel to the switch; on AireOS WLCs it must be static (mode on), with no LACP or PAgP.") },
    ],
    answers: { 0: "Local", 1: "FlexConnect", 2: "Monitor", 3: "Service port", 4: "LAG (link aggregation)" },
    teach: "Lightweight AP modes: local (default, traffic tunnelled to the WLC with CAPWAP), FlexConnect (local switching at branches, survives a WAN outage), monitor (no clients, scans for rogues), sniffer (captures for a packet analyser), rogue detector, SE-Connect (spectrum analysis), bridge/mesh. WLC ports: service port (out-of-band management), distribution ports (the trunk for WLAN and management traffic, often bundled into a LAG), console, and a redundancy port for HA.",
  }),
  ex({
    id: "ex-snmp-ntp", title: "SNMP versions and NTP strata",
    cmds: ["show ntp associations", "snmp-server"],
    intro: "From R1: its NTP associations, and the plan for monitoring it with SNMP.",
    exhibit: `R1#show ntp associations

  address         ref clock       st   when   poll reach  delay  offset   disp
*~10.0.0.10       .GPS.            1     27     64   377  1.204  -0.311  0.940
+~10.0.0.11       10.0.0.10        2     41     64   377  1.512  -0.402  0.951
 ~192.0.2.123     .INIT.          16      -     64     0  0.000   0.000 15937.
 * sys.peer, # selected, + candidate, - outlyer, x falseticker, ~ configured

Monitoring plan
  NMS 10.0.0.50 polls R1 every 5 minutes (GET) and receives traps
  The security team wants usernames, authentication and encryption`,
    tasks: [
      { text: "Which server is R1 synchronised to?", choices: ["10.0.0.10", "10.0.0.11", "192.0.2.123", "None of them"], check: pick("10.0.0.10", "The * marks the sys.peer: the server R1 synchronises to.") },
      { text: "What stratum will R1 itself be?", ask: "Stratum", check: (t) => need(is.num(t.reply, 2), "One more than its server: 10.0.0.10 is stratum 1 (a GPS clock), so R1 is stratum 2.") },
      { text: "What does stratum 16 on 192.0.2.123 mean?", choices: ["R1 cannot reach it or it is not synchronised: it is unusable", "It is the most accurate server", "It is 16 hops away", "It is a broadcast server"], check: pick("R1 cannot reach it or it is not synchronised: it is unusable", "Stratum 16 means unsynchronised; reach 0 shows R1 never heard from it.") },
      { text: "Which SNMP version meets the security team's wish?", choices: ["SNMPv3", "SNMPv2c", "SNMPv1", "Any version with a long community string"], check: pick("SNMPv3", "Only SNMPv3 has users, authentication and encryption (authPriv); v1 and v2c send a community string in clear text.") },
      { text: "Which UDP port does R1 send its traps to on the NMS?", ask: "Port", check: (t) => need(is.num(t.reply, 162), "The NMS polls the agent on UDP 161; traps and informs go to the manager on UDP 162.") },
    ],
    answers: { 0: "10.0.0.10", 1: "2", 2: "R1 cannot reach it or it is not synchronised: it is unusable", 3: "SNMPv3", 4: "162" },
    teach: "NTP stratum counts the distance from a reference clock: stratum 1 is attached to one (GPS, atomic), each client is one more, 16 means unsynchronised. In show ntp associations, * is the peer in use. SNMP: the manager (NMS) polls agents with GET and SET on UDP 161, and agents send traps or informs to UDP 162; an inform is acknowledged, a trap is not. v1 and v2c use community strings in clear text; v3 adds users, authentication and encryption.",
  }),
  ex({
    id: "ex-dns-records", title: "DNS records and nslookup",
    cmds: ["nslookup", "DNS"],
    intro: "Part of the company's DNS zone, and an nslookup from a PC.",
    exhibit: `example.local zone
  www      A      10.1.1.80
  www      AAAA   2001:db8:1::80
  intranet CNAME  www.example.local.
  @        MX 10  mail.example.local.
  mail     A      10.1.1.25
  80.1.1.10.in-addr.arpa  PTR  www.example.local.

C:\\> nslookup intranet.example.local
Server:  dns1.example.local
Address:  10.1.1.53

Name:    www.example.local
Addresses:  2001:db8:1::80
          10.1.1.80
Aliases:  intranet.example.local`,
    tasks: [
      { text: "Which record type maps a name to an IPv6 address?", choices: ["AAAA", "A", "PTR", "CNAME"], check: pick("AAAA", "A is for IPv4, AAAA (quad A) for IPv6.") },
      { text: "What is intranet.example.local?", choices: ["An alias (CNAME) for www.example.local", "A separate server with its own address", "The mail server", "A reverse lookup record"], check: pick("An alias (CNAME) for www.example.local", "A CNAME points one name at another; nslookup lists it under Aliases.") },
      { text: "Which record tells other mail servers where to deliver mail for example.local?", choices: ["MX", "A", "PTR", "AAAA"], check: pick("MX", "MX names the mail server for the domain, with a preference (lower is preferred).") },
      { text: "Which record answers nslookup 10.1.1.80?", choices: ["PTR", "A", "CNAME", "MX"], check: pick("PTR", "A reverse lookup asks for the PTR record of 80.1.1.10.in-addr.arpa.") },
      { text: "Which port does the PC send its query to on 10.1.1.53?", ask: "Port", check: (t) => need(is.num(t.reply, 53), "DNS uses port 53: UDP for ordinary queries, TCP for zone transfers and large answers.") },
    ],
    answers: { 0: "AAAA", 1: "An alias (CNAME) for www.example.local", 2: "MX", 3: "PTR", 4: "53" },
    teach: "DNS record types: A (name to IPv4), AAAA (name to IPv6), CNAME (an alias for another name), MX (the domain's mail server), PTR (address to name, in in-addr.arpa or ip6.arpa), NS (the zone's name servers). Clients query a resolver on port 53, normally over UDP. On a router, ip name-server sets the resolver and ip domain-lookup turns lookups on.",
  }),
  ex({
    id: "ex-fhrp", title: "First hop redundancy: show standby brief",
    cmds: ["show standby brief", "HSRP", "VRRP", "GLBP"],
    intro: "R1 and R2 share the gateways for VLAN 10 and VLAN 20 with HSRP version 1. This is R1.",
    exhibit: `R1#show standby brief
                     P indicates configured to preempt.
                     |
Interface   Grp  Pri P State   Active          Standby         Virtual IP
Gi0/0.10    10   110 P Active  local           10.1.10.3       10.1.10.1
Gi0/0.20    20   100   Standby 10.1.20.3       local           10.1.20.1`,
    tasks: [
      { text: "Which router forwards the traffic of VLAN 10's hosts?", choices: ["R1", "R2", "Both, shared per packet", "Neither: HSRP only watches"], check: pick("R1", "R1 is Active for group 10 (\"local\" in the Active column); R2, 10.1.10.3, waits as Standby.") },
      { text: "What default gateway should the hosts in VLAN 20 use?", ask: "IP address", check: (t) => need(is.ip(t.reply, "10.1.20.1"), "Hosts use the virtual IP, never a router's own address, so the gateway survives a router failure.") },
      { text: "Which MAC address answers ARP for 10.1.10.1 (HSRPv1, group 10)?", choices: ["0000.0c07.ac0a", "0000.0c9f.f00a", "0000.5e00.010a", "R1's G0/0 MAC"], check: pick("0000.0c07.ac0a", "HSRPv1 uses 0000.0c07.acXX with XX the group in hex (10 = 0a); v2 uses 0000.0c9f.fXXX, VRRP 0000.5e00.01XX.") },
      { text: "If R1 fails, will it take VLAN 10 back when it returns?", choices: ["Yes: it has the higher priority and preempt is set", "No: preemption is off by default and stays off", "Only after a reload of R2", "No: the Standby router always keeps the role"], check: pick("Yes: it has the higher priority and preempt is set", "Priority 110 beats the default 100, and the P shows preempt: R1 takes Active back as soon as it is up.") },
      { text: "Which first hop redundancy protocol is an open standard?", choices: ["VRRP", "HSRP", "GLBP", "CDP"], check: pick("VRRP", "VRRP is an IETF standard; HSRP and GLBP are Cisco's. GLBP also load-balances one group across several routers.") },
    ],
    answers: { 0: "R1", 1: "10.1.20.1", 2: "0000.0c07.ac0a", 3: "Yes: it has the higher priority and preempt is set", 4: "VRRP" },
    teach: "First hop redundancy gives hosts one virtual gateway IP and MAC that more than one router can own. HSRP (Cisco) has one Active and one Standby router per group, chosen by priority (default 100, higher wins, preempt lets a better router take over); VRRP (open standard) has a master and backups; GLBP (Cisco) shares the load of one group among routers. Load sharing with HSRP means one group per VLAN, with a different Active router for each.",
  }),
  ex({
    id: "ex-ipv4-ranges", title: "Private, public and APIPA addresses",
    cmds: ["ipconfig", "RFC 1918", "APIPA"],
    intro: "ipconfig from four PCs in one company.",
    exhibit: `PC-A   IPv4 Address. . . . : 169.254.33.7    Subnet Mask . . : 255.255.0.0
       Default Gateway . . :
PC-B   IPv4 Address. . . . : 172.20.5.9      Subnet Mask . . : 255.255.0.0
       Default Gateway . . : 172.20.0.1
PC-C   IPv4 Address. . . . : 192.168.1.20    Subnet Mask . . : 255.255.255.0
       Default Gateway . . : 192.168.1.1
PC-D   IPv4 Address. . . . : 172.32.4.10     Subnet Mask . . : 255.255.255.0
       Default Gateway . . : 172.32.4.1`,
    tasks: [
      { text: "Which PC did not get an answer from a DHCP server?", choices: ["PC-A", "PC-B", "PC-C", "PC-D"], check: pick("PC-A", "169.254.0.0/16 is APIPA (link-local): Windows picks one itself when DHCP fails, and has no gateway.") },
      { text: "Which PC has a public address, outside the private ranges?", choices: ["PC-D", "PC-B", "PC-C", "PC-A"], check: pick("PC-D", "The private 172 range is 172.16.0.0/12, which ends at 172.31.255.255; 172.32.4.10 is just outside it.") },
      { text: "Which prefix covers all the private 172 addresses?", choices: ["172.16.0.0/12", "172.0.0.0/8", "172.16.0.0/16", "172.16.0.0/20"], check: pick("172.16.0.0/12", "RFC 1918: 10.0.0.0/8, 172.16.0.0/12 (172.16 to 172.31) and 192.168.0.0/16.") },
      { text: "How many usable hosts does PC-B's subnet have?", ask: "Number", check: (t) => need(is.num(t.reply, 65534), "/16: 16 host bits, 2^16 - 2 = 65534.") },
      { text: "What does a PC with a private address need to reach the Internet?", choices: ["NAT on the way out", "A public DNS server", "A /8 mask", "APIPA"], check: pick("NAT on the way out", "Private addresses are not routed on the Internet; a router or firewall translates them to a public address (NAT/PAT).") },
    ],
    answers: { 0: "PC-A", 1: "PC-D", 2: "172.16.0.0/12", 3: "65534", 4: "NAT on the way out" },
    teach: "Private IPv4 ranges (RFC 1918): 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16; they need NAT to reach the Internet. 169.254.0.0/16 is APIPA: a client gives itself one of these when no DHCP server answers, so seeing it means a DHCP problem. 127.0.0.0/8 is loopback. Usable hosts in a subnet are 2^(host bits) - 2.",
  }),
  ex({
    id: "ex-ports", title: "Well-known ports in a firewall policy",
    cmds: ["TCP", "UDP", "port numbers"],
    intro: "The rules that let traffic into the management network. The Note column is empty: fill it in.",
    exhibit: `Rule  Proto  Dst port  Action   Note
----  -----  --------  -------  ----
10    TCP    22        permit
20    TCP    23        deny
30    UDP    69        permit
40    UDP    123       permit
50    UDP    514       permit
60    TCP    443       permit
70    UDP    161       permit`,
    tasks: [
      { text: "Which service does rule 10 let in?", choices: ["SSH", "Telnet", "HTTPS", "FTP"], check: pick("SSH", "SSH uses TCP 22; Telnet is TCP 23.") },
      { text: "Why would rule 20 deny that service?", choices: ["Telnet sends everything, passwords included, in clear text", "Telnet uses too much bandwidth", "Telnet only works over UDP", "Telnet cannot reach routers"], check: pick("Telnet sends everything, passwords included, in clear text", "That is why management access should use SSH (transport input ssh on the vty lines).") },
      { text: "Rule 30 lets in the protocol often used to copy IOS images and configurations. Which is it?", choices: ["TFTP", "FTP", "SCP", "HTTP"], check: pick("TFTP", "TFTP is UDP 69, simple and without authentication; FTP uses TCP 20 and 21.") },
      { text: "Which services in these rules run over UDP?", choices: ["TFTP, NTP, syslog and SNMP", "SSH and HTTPS", "Telnet and TFTP", "All of them"], check: pick("TFTP, NTP, syslog and SNMP", "Rules 30, 40, 50 and 70: TFTP 69, NTP 123, syslog 514, SNMP 161.") },
      { text: "Why do SSH and HTTPS use TCP?", choices: ["They need every byte delivered, in order, with retransmission", "TCP has smaller headers than UDP", "TCP needs no handshake", "UDP cannot carry encrypted data"], check: pick("They need every byte delivered, in order, with retransmission", "TCP is connection-oriented: a three-way handshake, sequence numbers, acknowledgements and retransmission. UDP is connectionless and suits short queries and real-time traffic such as voice.") },
    ],
    answers: { 0: "SSH", 1: "Telnet sends everything, passwords included, in clear text", 2: "TFTP", 3: "TFTP, NTP, syslog and SNMP", 4: "They need every byte delivered, in order, with retransmission" },
    teach: "Ports worth knowing: FTP 20/21, SSH 22, Telnet 23, SMTP 25, DNS 53 (UDP and TCP), DHCP 67/68, TFTP 69, HTTP 80, NTP 123, SNMP 161/162, HTTPS 443, syslog 514. TCP is connection-oriented and reliable (handshake, sequencing, acknowledgements, windowing); UDP is connectionless, with less overhead, for DNS queries, DHCP, TFTP, SNMP, syslog and voice and video.",
  }),
  ex({
    id: "ex-8021x", title: "The three roles in 802.1X",
    cmds: ["802.1X", "EAP", "RADIUS"],
    intro: "How wired access is secured on the user floors.",
    exhibit: `Laptop ---- SW1 Gi1/0/5 ---- (campus) ---- ISE 10.0.0.20

- The laptop runs an 802.1X client and sends EAP over LAN (EAPoL) to SW1.
- SW1 passes the EAP messages on to ISE inside RADIUS.
- ISE checks the user against Active Directory and answers Access-Accept
  or Access-Reject; it can also send back a VLAN for the user.
- Until then, Gi1/0/5 passes nothing but EAPoL.`,
    tasks: [
      { text: "What is the laptop's role?", choices: ["Supplicant", "Authenticator", "Authentication server", "Accounting server"], check: pick("Supplicant", "The device that asks for access is the supplicant.") },
      { text: "What is SW1's role?", choices: ["Authenticator", "Supplicant", "Authentication server", "Proxy client"], check: pick("Authenticator", "The switch (or WLC/AP on wireless) that controls the port is the authenticator: it relays, but does not decide.") },
      { text: "What is ISE's role?", choices: ["Authentication server", "Authenticator", "Supplicant", "DHCP server"], check: pick("Authentication server", "ISE is the RADIUS authentication server that makes the decision.") },
      { text: "Which protocol carries the conversation between SW1 and ISE?", choices: ["RADIUS", "EAPoL", "TACACS+", "CAPWAP"], check: pick("RADIUS", "EAPoL runs between supplicant and authenticator; the authenticator wraps EAP in RADIUS towards the server.") },
      { text: "What can the laptop send through Gi1/0/5 before it is authenticated?", choices: ["Only EAPoL frames", "DHCP and DNS only", "Everything except HTTP", "Everything: the port just logs it"], check: pick("Only EAPoL frames", "An 802.1X port stays unauthorised, passing only EAPoL, until the server accepts the client.") },
    ],
    answers: { 0: "Supplicant", 1: "Authenticator", 2: "Authentication server", 3: "RADIUS", 4: "Only EAPoL frames" },
    teach: "802.1X is port-based network access control with three roles: the supplicant (the client), the authenticator (the switch, or the WLC/AP on wireless) and the authentication server (RADIUS, such as Cisco ISE). EAP runs inside EAPoL on the LAN and inside RADIUS between authenticator and server. On wireless, WPA2/WPA3-Enterprise use the same 802.1X model.",
  }),
  ex({
    id: "ex-wpa-compare", title: "Open, WPA, WPA2 and WPA3 WLANs",
    cmds: ["WPA2", "WPA3", "SAE", "TKIP"],
    intro: "The WLANs a company still broadcasts after years of changes.",
    exhibit: `SSID        Security           Encryption    Authentication
----------  -----------------  ------------  ----------------------------
Guest       Open + web portal  none          captive portal (terms page)
Staff       WPA2-Enterprise    AES (CCMP)    802.1X, each user via ISE
Printers    WPA (version 1)    TKIP          one pre-shared key
NewOffice   WPA3-Personal      AES (CCMP)    SAE, one passphrase`,
    tasks: [
      { text: "Which WLAN uses deprecated security and should be replaced first?", choices: ["Printers", "Guest", "Staff", "NewOffice"], check: pick("Printers", "WPA with TKIP is broken and deprecated; it should move to WPA2 or WPA3 with AES.") },
      { text: "Whose traffic can anyone nearby capture and read over the air?", choices: ["Guest", "Staff", "NewOffice", "Printers"], check: pick("Guest", "An open WLAN has no encryption over the air; the web portal only asks users to accept terms.") },
      { text: "Which WLAN gives every user their own credentials?", choices: ["Staff", "NewOffice", "Printers", "Guest"], check: pick("Staff", "Enterprise mode uses 802.1X with a RADIUS server: each user logs in with their own account. Personal mode shares one key or passphrase.") },
      { text: "What does SAE in WPA3-Personal protect against that WPA2-PSK does not?", choices: ["Offline guessing of the passphrase from a captured handshake", "Rogue access points on other channels", "Users sharing the passphrase", "Interference from 2.4 GHz devices"], check: pick("Offline guessing of the passphrase from a captured handshake", "SAE (Simultaneous Authentication of Equals) replaces the PSK exchange, so a captured handshake cannot be attacked offline, and it gives forward secrecy.") },
      { text: "Which feature does WPA3 make mandatory?", choices: ["Protected Management Frames (PMF)", "TKIP", "WEP keys", "MAC filtering"], check: pick("Protected Management Frames (PMF)", "WPA3 requires PMF (802.11w), which stops forged deauthentication frames.") },
    ],
    answers: { 0: "Printers", 1: "Guest", 2: "Staff", 3: "Offline guessing of the passphrase from a captured handshake", 4: "Protected Management Frames (PMF)" },
    teach: "Wireless security in order: WEP (broken), WPA with TKIP (deprecated), WPA2 with AES-CCMP, WPA3 with SAE, PMF required and stronger options (GCMP-256, 192-bit mode for Enterprise). Personal mode shares one key (PSK in WPA2, SAE in WPA3); Enterprise mode authenticates each user with 802.1X and RADIUS. An open WLAN with a captive portal encrypts nothing.",
  }),
  ex({
    id: "ex-config-mgmt", title: "Configuration management tools compared",
    cmds: ["Ansible", "Puppet", "Chef", "Terraform"],
    intro: "A team compares tools for keeping 200 switch configurations consistent.",
    exhibit: `Tool       Written in    Agent on the device         How changes arrive
---------  ------------  --------------------------  -------------------------
Ansible    YAML          none (SSH or API)           pushed from a control node
Puppet     Puppet DSL    yes (or a proxy for IOS)    pulled from a master
Chef       Ruby          yes                         pulled from a server
Terraform  HCL           none (provider APIs)        plan, then apply

Constraint: the switches cannot run extra software.`,
    tasks: [
      { text: "Which tool fits the constraint best, with nothing installed on the switches?", choices: ["Ansible", "Puppet", "Chef", "None of them"], check: pick("Ansible", "Ansible is agentless: it connects over SSH (or an API) from a control node and pushes the changes.") },
      { text: "In which language are Chef recipes written?", choices: ["Ruby", "YAML", "Python", "HCL"], check: pick("Ruby", "Chef cookbooks and recipes are Ruby; Ansible playbooks are YAML; Terraform uses HCL.") },
      { text: "Which two tools have the device pull its configuration?", choices: ["Puppet and Chef", "Ansible and Terraform", "Ansible and Puppet", "Chef and Terraform"], check: pick("Puppet and Chef", "Their agents check in with a server and pull the desired state; Ansible pushes.") },
      { text: "Which benefit do all of them give over typing each configuration by hand?", choices: ["The same tested configuration, kept in version control, applied everywhere", "They replace the need for routing protocols", "They make SSH unnecessary", "They only work in the cloud"], check: pick("The same tested configuration, kept in version control, applied everywhere", "Configuration as code: consistent, repeatable changes, history in Git, less drift between devices.") },
    ],
    answers: { 0: "Ansible", 1: "Ruby", 2: "Puppet and Chef", 3: "The same tested configuration, kept in version control, applied everywhere" },
    teach: "Configuration management keeps devices at a defined state from code. Ansible: agentless, YAML playbooks, push over SSH or APIs. Puppet: agent-based pull, its own declarative language (manifests). Chef: agent-based pull, Ruby recipes and cookbooks. Terraform: declarative infrastructure provisioning through provider APIs with HCL (plan, then apply). All of them make changes repeatable and versionable.",
  }),
  ex({
    id: "ex-rest-codes", title: "REST verbs and status codes",
    cmds: ["REST", "HTTP verbs", "status codes"],
    intro: "A script talked to a controller's REST API. These are its calls and the answers.",
    exhibit: `1  GET    /api/v1/devices                     -> 401 Unauthorized
2  POST   /api/v1/auth/token                  -> 200 OK  {"token": "eyJh..."}
3  GET    /api/v1/devices                     -> 200 OK  [ ...42 devices... ]
4  PATCH  /api/v1/devices/17  {"location":"B2"} -> 200 OK
5  DELETE /api/v1/devices/99                  -> 404 Not Found
6  POST   /api/v1/devices      {...}          -> 201 Created
7  GET    /api/v1/reports/daily               -> 503 Service Unavailable`,
    tasks: [
      { text: "Why did call 1 fail?", choices: ["The script had not authenticated yet: no token", "The URL does not exist", "The controller is down", "GET is not allowed on /devices"], check: pick("The script had not authenticated yet: no token", "401 means the request lacks valid credentials; call 2 gets a token and call 3 then works.") },
      { text: "Which CRUD operation is call 4?", choices: ["Update", "Create", "Read", "Delete"], check: pick("Update", "PATCH changes part of a resource (PUT replaces it whole): both are Update.") },
      { text: "What does call 5's answer mean?", choices: ["There is no device 99 to delete", "The script may not delete devices", "The device was deleted", "The server failed"], check: pick("There is no device 99 to delete", "404 Not Found: the resource does not exist. A missing permission would be 403 Forbidden.") },
      { text: "Which call failed because of the server, not the client?", choices: ["Call 7", "Call 1", "Call 5", "Call 6"], check: pick("Call 7", "4xx codes are client errors; 5xx are server errors, such as 503 when the service is unavailable.") },
      { text: "Which HTTP verb maps to Read?", choices: ["GET", "POST", "PUT", "DELETE"], check: pick("GET", "Create = POST, Read = GET, Update = PUT or PATCH, Delete = DELETE.") },
    ],
    answers: { 0: "The script had not authenticated yet: no token", 1: "Update", 2: "There is no device 99 to delete", 3: "Call 7", 4: "GET" },
    teach: "REST maps CRUD to HTTP verbs: POST creates, GET reads, PUT replaces and PATCH modifies (update), DELETE deletes. Status codes: 2xx success (200 OK, 201 Created, 204 No Content), 3xx redirection, 4xx client errors (400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found), 5xx server errors (500, 503). Controllers usually hand out a token that later requests carry in a header.",
  }),
  ex({
    id: "ex-subnet-drill", title: "Subnetting drill: network, broadcast, same subnet",
    cmds: ["subnet mask", "broadcast address", "prefix length"],
    intro: "Five quick ones, the way the exam asks them. Work them out on paper, then check.",
    exhibit: `a)  Host 10.10.37.200/21           network address? broadcast address?
b)  192.168.5.130/26 and 192.168.5.190/26: same subnet?
c)  Host 172.16.100.17/28           broadcast address?
d)  A subnet must hold 500 hosts:   longest prefix that fits?
e)  How many /27 subnets fit in 192.168.20.0/24?`,
    tasks: [
      { text: "a) Network address of 10.10.37.200/21?", ask: "IP address", check: (t) => need(is.ip(t.reply, "10.10.32.0"), "/21 = 255.255.248.0: blocks of 8 in the third octet. 37 falls in 32-39.") },
      { text: "a) Its broadcast address?", ask: "IP address", check: (t) => need(is.ip(t.reply, "10.10.39.255"), "The block 32-39 ends at 10.10.39.255.") },
      { text: "b) Are 192.168.5.130/26 and 192.168.5.190/26 in the same subnet?", choices: ["Yes", "No"], check: pick("Yes", "/26 blocks of 64: .128 to .191. Both addresses are inside it.") },
      { text: "c) Broadcast address of 172.16.100.17/28?", ask: "IP address", check: (t) => need(is.ip(t.reply, "172.16.100.31"), "/28 blocks of 16: .16 to .31.") },
      { text: "d) Longest prefix that holds 500 hosts?", ask: "/n", check: (t) => need(is.prefix(t.reply, 23), "9 host bits give 510 hosts (2^9 - 2); 8 bits give only 254.") },
      { text: "e) How many /27 subnets fit in a /24?", ask: "Number", check: (t) => need(is.num(t.reply, 8), "3 more network bits: 2^3 = 8 subnets of 32 addresses.") },
    ],
    answers: { 0: "10.10.32.0", 1: "10.10.39.255", 2: "Yes", 3: "172.16.100.31", 4: "/23", 5: "8" },
    teach: "Find the interesting octet (where the mask is neither 255 nor 0), take the block size 256 minus the mask value there, and find the multiple of it at or below the address: that is the network; the next block minus one is the broadcast. Hosts = 2^(host bits) - 2; subnets made from a bigger block = 2^(borrowed bits).",
  }),
  ex({
    id: "ex-wlc-gui", title: "Creating a WLAN in the WLC GUI",
    cmds: ["WLC GUI", "policy profile", "policy tag", "QoS profile"],
    intro: "A new staff WLAN on a Catalyst 9800 WLC, set up in its web interface. These are the pages that were filled in.",
    exhibit: `Configuration > Tags & Profiles > WLANs > + Add
  General       Profile Name: STAFF   SSID: STAFF   WLAN ID: 3   Status: Enabled
                Radio Policy: 5 GHz only
  Security      Layer2: WPA2 + WPA3, AES (CCMP128), Auth Key Mgmt: 802.1X
                AAA: Authentication List ISE-AUTH (RADIUS servers 10.0.0.20, .21)
  Advanced      Session Timeout: 1800 s

Configuration > Tags & Profiles > Policy > STAFF-POLICY
  Access Policies   VLAN: 30
  QoS and AVC       QoS SSID Policy (egress): platinum

Configuration > Tags & Profiles > Tags > Policy > default-policy-tag
  WLAN-POLICY Maps  STAFF -> STAFF-POLICY`,
    tasks: [
      { text: "In which VLAN do STAFF clients end up?", ask: "VLAN", check: (t) => need(is.num(t.reply, 30), "The VLAN is set in the policy profile (Access Policies), not in the WLAN profile.") },
      { text: "What ties the STAFF WLAN to STAFF-POLICY?", choices: ["The policy tag's WLAN-POLICY map", "The SSID name", "The WLAN ID", "The RADIUS server"], check: pick("The policy tag's WLAN-POLICY map", "On the 9800, a policy tag maps each WLAN profile to a policy profile; the tag is then applied to the APs.") },
      { text: "Which QoS profile suits a WLAN carrying voice calls?", choices: ["platinum", "gold", "silver", "bronze"], check: pick("platinum", "Platinum is for voice, gold for video, silver best effort (the default), bronze background.") },
      { text: "Can a laptop that only has a 2.4 GHz radio join STAFF?", choices: ["No: the radio policy is 5 GHz only", "Yes: SSIDs are on every band", "Yes, but without encryption", "Only after the session timeout"], check: pick("No: the radio policy is 5 GHz only", "The WLAN is broadcast only on the 5 GHz radios of the APs.") },
      { text: "Who checks each user's credentials?", choices: ["The RADIUS servers in the ISE-AUTH list", "The WLC's local database", "The access point", "Nobody: WPA3 needs no login"], check: pick("The RADIUS servers in the ISE-AUTH list", "802.1X key management sends each login to the RADIUS servers of the authentication list.") },
    ],
    answers: { 0: "30", 1: "The policy tag's WLAN-POLICY map", 2: "platinum", 3: "No: the radio policy is 5 GHz only", 4: "The RADIUS servers in the ISE-AUTH list" },
    teach: "Creating a WLAN in the GUI: the WLAN profile holds the SSID, its status, radio policy and security (Layer 2 such as WPA2/WPA3 with PSK, SAE or 802.1X, and the AAA list); the policy profile holds the VLAN, QoS and other client policies; a policy tag maps WLAN to policy profile and is assigned to the APs. QoS profiles: platinum (voice), gold (video), silver (best effort), bronze (background). Older AireOS WLCs put the same settings on the WLAN's tabs (General, Security, QoS, Advanced) with an interface for the VLAN.",
  }),
  ex({
    id: "ex-ipv6-subnetting", title: "IPv6 subnetting and EUI-64",
    cmds: ["ipv6 address", "eui-64", "/48", "/64"],
    intro: "The ISP gave the company 2001:DB8:ACAD::/48. Every VLAN gets a /64, and the VLAN number (in hex) is the subnet ID.",
    exhibit: `Prefix from the ISP:   2001:DB8:ACAD::/48
Plan:                  2001:DB8:ACAD:<subnet ID>::/64   subnet ID = VLAN number in hex
VLAN 10  users         2001:DB8:ACAD:A::/64
VLAN 20  voice         ?
R1 G0/1 MAC address    0050.7966.6800
R1(config-if)# ipv6 address 2001:DB8:ACAD:A::/64 eui-64`,
    tasks: [
      { text: "How many /64 subnets fit in the /48?", ask: "Number", check: (t) => need(is.num(t.reply, 65536), "From /48 to /64 is 16 bits of subnet ID: 2^16 = 65536.") },
      { text: "Which /64 does VLAN 20 get?", choices: ["2001:DB8:ACAD:14::/64", "2001:DB8:ACAD:20::/64", "2001:DB8:ACAD:2::/64", "2001:DB8:ACAD:0:20::/64"], check: pick("2001:DB8:ACAD:14::/64", "20 in hex is 14, written as the fourth hextet.") },
      { text: "What interface ID does EUI-64 make from MAC 0050.7966.6800?", choices: ["0250:79FF:FE66:6800", "0050:79FF:FE66:6800", "0250:7966:6800:FFFE", "FFFE:0050:7966:6800"], check: pick("0250:79FF:FE66:6800", "Split the MAC, put FFFE in the middle (0050:79FF:FE66:6800) and flip the 7th bit of the first byte: 00 becomes 02.") },
      { text: "Which prefix length must a LAN have for SLAAC to work?", ask: "/n", check: (t) => need(is.prefix(t.reply, 64), "SLAAC builds a 64-bit interface ID, so the prefix must be a /64.") },
    ],
    answers: { 0: "65536", 1: "2001:DB8:ACAD:14::/64", 2: "0250:79FF:FE66:6800", 3: "/64" },
    teach: "IPv6 subnetting is usually done in the fourth hextet: a /48 site has 16 bits of subnet ID, 65536 /64 subnets, and every LAN is a /64 (needed by SLAAC). EUI-64 builds the 64-bit interface ID from the MAC: insert FFFE in the middle and invert the universal/local bit (the 7th bit of the first byte). Leading zeros in a hextet can be dropped and one run of zero hextets can become ::.",
  }),
  ex({
    id: "ex-wan", title: "Choosing WAN links for the branches",
    cmds: ["MPLS", "Metro Ethernet", "Internet VPN", "4G/5G"],
    intro: "The connections a company uses between its head office and branches.",
    exhibit: `Branch   Link                            Notes
-------  ------------------------------  -------------------------------------------
North    MPLS VPN from the carrier       private, carrier keeps the sites apart, QoS
East     Metro Ethernet E-Line           a layer 2 circuit across the city, like a cable
South    Business fibre Internet         site-to-site IPsec VPN to HQ over the Internet
Kiosk    4G/5G router                    backup and small sites, no cable needed`,
    tasks: [
      { text: "Which branch's traffic crosses a public network and therefore needs its own encryption?", choices: ["South", "North", "East", "None of them"], check: pick("South", "Over the Internet the company itself must protect the traffic, here with a site-to-site IPsec VPN.") },
      { text: "Which link makes the branch look as if it were on the same LAN segment as HQ?", choices: ["East (Metro Ethernet E-Line)", "North (MPLS)", "South (Internet VPN)", "Kiosk (4G/5G)"], check: pick("East (Metro Ethernet E-Line)", "Metro Ethernet E-Line is a point-to-point layer 2 service: the two routers see each other as directly connected.") },
      { text: "In the MPLS VPN, which device does the branch router route with?", choices: ["The carrier's provider edge (PE) router", "The HQ router directly, over layer 2", "Every other branch router", "None: MPLS is not routed"], check: pick("The carrier's provider edge (PE) router", "With a layer 3 MPLS VPN the customer edge (CE) router peers with the carrier's PE router, which carries the routes to the other sites.") },
      { text: "Why does Kiosk use 4G/5G?", choices: ["No cable is needed, which suits small or temporary sites and backups", "It is always faster than fibre", "It is the only private WAN", "It needs no SIM or carrier"], check: pick("No cable is needed, which suits small or temporary sites and backups", "Cellular links are quick to deploy anywhere there is coverage, often as a backup to a wired link.") },
    ],
    answers: { 0: "South", 1: "East (Metro Ethernet E-Line)", 2: "The carrier's provider edge (PE) router", 3: "No cable is needed, which suits small or temporary sites and backups" },
    teach: "WAN options: leased lines and Metro Ethernet (layer 2 services such as E-Line point to point, E-LAN multipoint); MPLS VPNs, where the customer edge router routes with the carrier's provider edge router and the carrier keeps customers apart; Internet links (DSL, cable, fibre) with site-to-site or remote-access VPNs for privacy; and 4G/5G cellular for quick, cable-free or backup links.",
  }),
  ex({
    id: "ex-cloud", title: "On-premises, cloud and the service models",
    cmds: ["IaaS", "PaaS", "SaaS", "on-premises"],
    intro: "Where a company runs its services today.",
    exhibit: `Service           Runs on                                          Who manages the OS
----------------  -----------------------------------------------  ------------------
File server       Company servers in the company's own server room company
Email             Microsoft 365, used through a browser and app      provider
Build servers     Virtual machines rented from a cloud provider     company
Web app           Code uploaded to a platform that runs and scales  provider
                  it; the company never sees a server`,
    tasks: [
      { text: "Which service is on-premises?", choices: ["File server", "Email", "Build servers", "Web app"], check: pick("File server", "On-premises means in the company's own building, on its own hardware.") },
      { text: "Which service model are the build servers?", choices: ["IaaS", "PaaS", "SaaS", "On-premises"], check: pick("IaaS", "Infrastructure as a Service: rented VMs, networks and storage; the customer still runs the OS and everything above it.") },
      { text: "Which service model is the web app?", choices: ["PaaS", "IaaS", "SaaS", "On-premises"], check: pick("PaaS", "Platform as a Service: the customer brings code, the provider runs the OS, runtime and scaling.") },
      { text: "Which service model is the email?", choices: ["SaaS", "PaaS", "IaaS", "On-premises"], check: pick("SaaS", "Software as a Service: a finished application used over the Internet.") },
    ],
    answers: { 0: "File server", 1: "IaaS", 2: "PaaS", 3: "SaaS" },
    teach: "Cloud service models, from most to least customer-managed: IaaS (virtual servers, storage, networks), PaaS (a platform that runs your code), SaaS (a finished application). Cloud computing is on-demand, self-service, broadly reachable over the network, pooled and elastic, and measured by use. Deployments can be public, private, community or hybrid. Reaching a cloud can be over the Internet (with a VPN) or a private WAN link.",
  }),
  ex({
    id: "ex-stp-states", title: "STP port states and timers",
    cmds: ["blocking", "listening", "learning", "forwarding", "Max Age", "Forward Delay"],
    intro: "SW3 runs PVST+ (802.1D timers). A few seconds ago Fa0/3 and Fa0/4 came up.",
    exhibit: `SW3#show spanning-tree vlan 10

VLAN0010
  Spanning tree enabled protocol ieee
  Root ID    Priority    24586
             Address     0001.42a3.1111
             Cost        19
             Port        1 (FastEthernet0/1)
             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec

  Bridge ID  Priority    32778  (priority 32768 sys-id-ext 10)
             Address     0001.42a3.3333
             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec
             Aging Time  300 sec

Interface           Role Sts Cost      Prio.Nbr Type
------------------- ---- --- --------- -------- --------------------------------
Fa0/1               Root FWD 19        128.1    P2p
Fa0/2               Altn BLK 19        128.2    P2p
Fa0/3               Desg LIS 19        128.3    P2p
Fa0/4               Desg LRN 19        128.4    P2p
Fa0/5               Desg FWD 19        128.5    P2p Edge`,
    tasks: [
      { text: "Which port learns MAC addresses but does not forward frames yet?", choices: ["Fa0/4", "Fa0/3", "Fa0/2", "Fa0/5"], check: pick("Fa0/4", "LRN (learning): the port fills the MAC table from the frames it receives but forwards none of them yet.") },
      { text: "Fa0/3 has just entered listening. With these timers, how many seconds until it forwards?", ask: "Seconds", check: (t) => need(is.num(t.reply, 30), "Listening for one Forward Delay (15 s), then learning for another (15 s): 30 seconds.") },
      { text: "Fa0/1 stops receiving BPDUs without going down (an indirect failure). How long until Fa0/2 forwards?", ask: "Seconds", check: (t) => need(is.num(t.reply, 50), "Max Age (20 s) for the root's BPDU to expire, then listening (15 s) and learning (15 s): 50 seconds.") },
      { text: "Why is Fa0/5 already forwarding?", choices: ["It is a PortFast (edge) port, so it skips listening and learning", "It is the root port", "Edge ports have a lower cost", "It was up before the others"], check: pick("It is a PortFast (edge) port, so it skips listening and learning", "PortFast puts an access port straight into forwarding; use it only toward end hosts.") },
      { text: "What priority is configured on the root bridge for VLAN 10?", ask: "Priority", check: (t) => need(is.num(t.reply, 24576), "The bridge priority shown includes the VLAN (sys-id-ext): 24586 - 10 = 24576.") },
      { text: "Which RSTP state takes the place of 802.1D's blocking and listening?", choices: ["Discarding", "Learning", "Disabled", "Alternate"], check: pick("Discarding", "RSTP has three states: discarding, learning and forwarding. Alternate is a role, not a state.") },
    ],
    answers: { 0: "Fa0/4", 1: "30", 2: "50", 3: "It is a PortFast (edge) port, so it skips listening and learning", 4: "24576", 5: "Discarding" },
    teach: "802.1D port states: blocking (only listens to BPDUs), listening (takes part in the election, no MAC learning), learning (learns MACs, does not forward), forwarding, and disabled. Timers come from the root: Hello 2 s, Max Age 20 s (how long a BPDU stays valid), Forward Delay 15 s (each of listening and learning). A port that comes up needs 30 s; after an indirect failure it takes up to 50 s. PortFast skips straight to forwarding on edge ports. RSTP (802.1w) uses discarding, learning and forwarding and converges in about a second with proposals and agreements.",
  }),
  ex({
    id: "ex-ospf-states", title: "OSPF neighbor states",
    cmds: ["Init", "2-Way", "ExStart", "Exchange", "Loading", "Full"],
    intro: "Six routers share one Ethernet segment. This is R1's view.",
    exhibit: `R1#show ip ospf neighbor

Neighbor ID     Pri   State           Dead Time   Address         Interface
2.2.2.2           1   FULL/DR         00:00:36    10.0.0.2        GigabitEthernet0/0
3.3.3.3           1   FULL/BDR        00:00:31    10.0.0.3        GigabitEthernet0/0
4.4.4.4           1   2WAY/DROTHER    00:00:33    10.0.0.4        GigabitEthernet0/0
5.5.5.5           1   EXSTART/DROTHER 00:00:38    10.0.0.5        GigabitEthernet0/0
6.6.6.6           0   INIT/DROTHER    00:00:35    10.0.0.6        GigabitEthernet0/0`,
    tasks: [
      { text: "Which role does R1 itself have on this segment?", choices: ["DROTHER", "DR", "BDR", "It cannot be told from this output"], check: pick("DROTHER", "R1 stays at 2WAY with 4.4.4.4, another DROTHER. Only two DROTHERs stop at 2-Way, so R1 is neither DR nor BDR.") },
      { text: "Is the 2WAY state with 4.4.4.4 a fault?", choices: ["No: two DROTHERs stay at 2-Way by design", "Yes: the hello timers differ", "Yes: the areas differ", "Yes: 4.4.4.4 has the wrong priority"], check: pick("No: two DROTHERs stay at 2-Way by design", "On a broadcast segment every router goes Full only with the DR and BDR. That keeps the number of adjacencies down.") },
      { text: "5.5.5.5 never gets past EXSTART. What is the most likely cause?", choices: ["An MTU mismatch on the segment", "Mismatched hello and dead timers", "A different area number", "A duplicate router ID"], check: pick("An MTU mismatch on the segment", "Timers, area and router ID problems stop routers before 2-Way, so the neighbor never shows. A different MTU breaks the database description exchange: stuck in ExStart or Exchange.") },
      { text: "What does INIT for 6.6.6.6 tell you?", choices: ["R1 hears 6.6.6.6's hellos, but they do not list R1 yet", "6.6.6.6 and R1 are fully adjacent", "6.6.6.6 is being elected DR", "R1 has not heard from 6.6.6.6 at all"], check: pick("R1 hears 6.6.6.6's hellos, but they do not list R1 yet", "Init: a hello arrived, but without our router ID in its neighbor list. If it stays there, R1's hellos are not getting to 6.6.6.6 (for example an ACL).") },
      { text: "In which state do two routers send each other summaries (DBDs) of their link-state databases?", choices: ["Exchange", "ExStart", "Loading", "2-Way"], check: pick("Exchange", "ExStart picks who leads the exchange, Exchange sends the DBDs, Loading requests the LSAs that are missing, Full means the databases match.") },
      { text: "Which neighbor can never become DR or BDR?", ask: "Router ID", check: (t) => need(is.ip(t.reply, "6.6.6.6"), "Priority 0 takes no part in the DR/BDR election.") },
    ],
    answers: { 0: "DROTHER", 1: "No: two DROTHERs stay at 2-Way by design", 2: "An MTU mismatch on the segment", 3: "R1 hears 6.6.6.6's hellos, but they do not list R1 yet", 4: "Exchange", 5: "6.6.6.6" },
    teach: "OSPF neighbor states: Down, Init (a hello arrived without our router ID), 2-Way (each lists the other; the DR/BDR election happens here, and two DROTHERs stay here), ExStart (master and slave chosen), Exchange (DBDs), Loading (LSRs for missing LSAs, answered with LSUs), Full. Mismatched area, subnet, timers, authentication or a duplicate router ID stop a neighbor before 2-Way; an MTU mismatch typically sticks it in ExStart/Exchange.",
  }),
  ex({
    id: "ex-ipv6-ndp", title: "IPv6 Neighbor Discovery in a capture",
    cmds: ["NDP", "RS", "RA", "NS", "NA", "DAD", "solicited-node multicast"],
    intro: "PC1 has just been plugged into a link where R1 (fe80::1) is the router. These are the first ICMPv6 packets it sends and receives.",
    exhibit: `No. Source                            Destination                       Info
--- --------------------------------  --------------------------------  ------------------------------------------------
1   ::                                ff02::1:ff3c:4d5e                 Neighbor Solicitation for fe80::21a:2bff:fe3c:4d5e
2   fe80::21a:2bff:fe3c:4d5e          ff02::2                           Router Solicitation
3   fe80::1                           ff02::1                           Router Advertisement (prefix 2001:db8:10::/64)
4   2001:db8:10:0:21a:2bff:fe3c:4d5e  ff02::1:ff00:1                    Neighbor Solicitation for 2001:db8:10::1
5   2001:db8:10::1                    2001:db8:10:0:21a:2bff:fe3c:4d5e  Neighbor Advertisement 2001:db8:10::1 (rtr, sol)`,
    tasks: [
      { text: "What is packet 1 for?", choices: ["Duplicate Address Detection: making sure no one else uses PC1's new link-local address", "Finding the router", "Resolving R1's MAC address", "Asking DHCPv6 for an address"], check: pick("Duplicate Address Detection: making sure no one else uses PC1's new link-local address", "DAD is a Neighbor Solicitation for the host's own tentative address. If a Neighbor Advertisement comes back, the address is already taken.") },
      { text: "Why does packet 1 come from :: (the unspecified address)?", choices: ["PC1 may not use the address until DAD finishes", "PC1 has no MAC address yet", ":: is the all-routers address", "Neighbor Solicitations always come from ::"], check: pick("PC1 may not use the address until DAD finishes", "Until DAD succeeds the address is tentative, so the host sends from the unspecified address.") },
      { text: "Which packet gives PC1 its prefix and its default gateway?", choices: ["3 (Router Advertisement)", "2 (Router Solicitation)", "5 (Neighbor Advertisement)", "1 (Neighbor Solicitation)"], check: pick("3 (Router Advertisement)", "The RA carries the prefix for SLAAC, and its source (fe80::1, a link-local address) becomes the default gateway.") },
      { text: "Who receives packet 3, sent to ff02::1?", choices: ["Every IPv6 node on the link", "Only routers on the link", "Only PC1", "Every node on the Internet"], check: pick("Every IPv6 node on the link", "ff02::1 is all nodes on the link; ff02::2, where the RS went, is all routers on the link.") },
      { text: "Packets 4 and 5 do the job of which IPv4 protocol?", choices: ["ARP", "DHCP", "ICMP echo", "IGMP"], check: pick("ARP", "NS and NA resolve an IPv6 address to a MAC address, as ARP does for IPv4, but with ICMPv6 and multicast instead of broadcast.") },
      { text: "What is the solicited-node multicast address for 2001:db8:10::abcd:1234?", ask: "IPv6 address", check: (t) => need(t.reply.trim().toLowerCase() === "ff02::1:ffcd:1234", "ff02::1:ff followed by the last 24 bits of the address (cd:1234): ff02::1:ffcd:1234.") },
    ],
    answers: { 0: "Duplicate Address Detection: making sure no one else uses PC1's new link-local address", 1: "PC1 may not use the address until DAD finishes", 2: "3 (Router Advertisement)", 3: "Every IPv6 node on the link", 4: "ARP", 5: "ff02::1:ffcd:1234" },
    teach: "NDP (ICMPv6) has four messages a CCNA needs: Router Solicitation (host to ff02::2, all routers), Router Advertisement (router to ff02::1, all nodes, or to the host: prefix, prefix length, default gateway), Neighbor Solicitation and Neighbor Advertisement (address to MAC resolution, like ARP, sent to the target's solicited-node multicast address ff02::1:ffXX:XXXX built from the last 24 bits). Duplicate Address Detection is an NS for the host's own tentative address, sent from ::.",
  }),
  ex({
    id: "ex-planes", title: "Control, data and management planes",
    cmds: ["control plane", "data plane", "management plane", "SDN"],
    intro: "Things that happen on R1 and SW1 during one minute.",
    exhibit: `#  Event
-- ------------------------------------------------------------------
1  OSPF exchanges LSAs with a neighbor and runs SPF
2  SW1 sends a frame out of the port its MAC table lists for the destination
3  An administrator logs in with SSH and changes a description
4  R1 forwards a packet using its CEF table and rewrites the Ethernet header
5  An NMS polls R1's interface counters with SNMP
6  SW1 sends BPDUs and blocks a redundant port
7  R1 answers an ARP request for its own address`,
    tasks: [
      { text: "Which events are data plane?", choices: ["2 and 4", "1 and 6", "3 and 5", "2, 4 and 7"], check: pick("2 and 4", "The data (forwarding) plane moves user traffic through the device: switching frames, forwarding packets and rewriting headers.") },
      { text: "Which plane do 3 and 5 belong to?", choices: ["Management", "Control", "Data", "Both control and data"], check: pick("Management", "SSH, SNMP, syslog and NTP are how people and tools reach and manage the device.") },
      { text: "Which plane do 1, 6 and 7 belong to?", choices: ["Control", "Data", "Management", "None: they are hardware functions"], check: pick("Control", "Control plane protocols (OSPF, STP, ARP, CDP) build the tables the data plane then uses.") },
      { text: "In SDN, which plane does the controller take over from the devices?", choices: ["Control (or most of it)", "Data", "Management only", "None of them"], check: pick("Control (or most of it)", "A controller centralizes the control plane and programs the devices, which keep forwarding in their own data plane.") },
      { text: "Which interface does the controller use to program the devices?", choices: ["Southbound (OpenFlow, NETCONF, RESTCONF)", "Northbound (a REST API for applications)", "The console port", "The data plane"], check: pick("Southbound (OpenFlow, NETCONF, RESTCONF)", "Southbound faces the network devices; northbound faces the applications and scripts that use the controller.") },
    ],
    answers: { 0: "2 and 4", 1: "Management", 2: "Control", 3: "Control (or most of it)", 4: "Southbound (OpenFlow, NETCONF, RESTCONF)" },
    teach: "Data plane: forwarding user traffic (switching, routing lookups, header rewrites, ACLs applied to traffic). Control plane: deciding how to forward (routing protocols, STP, ARP, CDP/LLDP). Management plane: reaching and managing the device (SSH, Telnet, SNMP, syslog, NTP, the console). Controller-based networking (SDN) moves much of the control plane to a controller that programs devices over southbound APIs and offers northbound APIs to applications.",
  }),
  ex({
    id: "ex-passwords", title: "Passwords: hashing and encryption",
    cmds: ["enable secret", "service password-encryption", "type 5", "type 7", "hashing"],
    intro: "Lines from R1's running configuration.",
    exhibit: `R1#show running-config | include secret|password|username|line vty|login
service password-encryption
enable secret 5 $1$cqJl$c0hZkq2dbWoZL4w7KAjpyc
username admin secret 5 $1$zGOJ$X84J50Z5saJ9kOpTx2OXBc
username backup password 7 0224055800131F621E1A
line vty 0 4
 password 7 023010423B071C321D
 login local`,
    tasks: [
      { text: "Which lines could someone who sees this output turn back into the clear-text passwords?", choices: ["The two type 7 lines (backup and the vty password)", "The two type 5 lines", "All four", "None of them"], check: pick("The two type 7 lines (backup and the vty password)", "Type 7 is a weak, reversible encoding; free tools decode it in a second. It only stops someone reading the screen over your shoulder.") },
      { text: "What does the 5 in enable secret 5 mean?", choices: ["The secret is stored as an MD5-based hash", "The secret is 5 characters long", "Privilege level 5", "It was encrypted 5 times"], check: pick("The secret is stored as an MD5-based hash", "Type 5 is a salted MD5 hash. Newer IOS also offers type 8 (PBKDF2) and type 9 (scrypt), which are harder to crack.") },
      { text: "What made the backup and vty passwords show as type 7?", choices: ["service password-encryption", "login local", "enable secret", "They were typed that way"], check: pick("service password-encryption", "It encodes every clear-text password in the configuration as type 7. It has no effect on secrets, which are hashed already.") },
      { text: "Which credentials are accepted for a Telnet or SSH login on the vty lines?", choices: ["Usernames admin and backup, with their own passwords", "Only the vty line password", "Only the enable secret", "Anyone, with no password"], check: pick("Usernames admin and backup, with their own passwords", "login local checks the local username database. The line password is ignored while login local is set.") },
      { text: "Which statement about hashing and encryption is true?", choices: ["A hash cannot be turned back into the original; encrypted data can be decrypted with the key", "Both can be reversed with the right key", "A hash needs a key to be checked", "Encryption always gives the same output length"], check: pick("A hash cannot be turned back into the original; encrypted data can be decrypted with the key", "To check a password the device hashes what you type and compares the hashes. Encryption (AES, RSA) protects data that has to be read again later.") },
    ],
    answers: { 0: "The two type 7 lines (backup and the vty password)", 1: "The secret is stored as an MD5-based hash", 2: "service password-encryption", 3: "Usernames admin and backup, with their own passwords", 4: "A hash cannot be turned back into the original; encrypted data can be decrypted with the key" },
    teach: "Use secret, not password: enable secret and username ... secret store a one-way hash (type 5 MD5, or the stronger type 8 and 9). password stores clear text (type 0), and service password-encryption only turns it into reversible type 7. A hash is one-way and is checked by hashing the input again; encryption is two-way with a key (symmetric such as AES, or asymmetric such as RSA). Good practice: long passwords or passphrases, MFA where possible, and never reuse a password.",
  }),
  ex({
    id: "ex-wildcards", title: "Wildcard mask drill",
    cmds: ["wildcard mask", "access-list", "host", "any"],
    intro: "Two ACLs on R1. Work out what each line matches.",
    exhibit: `R1#show access-lists
Standard IP access list 10
    10 permit 192.168.10.0, wildcard bits 0.0.0.255
    20 permit 10.1.1.16, wildcard bits 0.0.0.15
    30 permit 172.16.0.0, wildcard bits 0.0.255.255
    40 permit 10.2.2.2
Extended IP access list 110
    10 permit tcp 10.0.0.0 0.0.0.3 any eq 22`,
    tasks: [
      { text: "Which addresses does line 20 of ACL 10 match?", choices: ["10.1.1.16 to 10.1.1.31", "10.1.1.16 to 10.1.1.15", "10.1.1.0 to 10.1.1.15", "10.1.1.16 only"], check: pick("10.1.1.16 to 10.1.1.31", "A wildcard of 0.0.0.15 lets the last 4 bits vary: 16 addresses starting at 10.1.1.16.") },
      { text: "Is 10.1.1.33 permitted by ACL 10?", choices: ["No, it falls to the implicit deny", "Yes, by line 20", "Yes, by line 10", "Yes, by line 40"], check: pick("No, it falls to the implicit deny", "Line 20 stops at .31 and no other line matches, so the implicit deny any at the end drops it.") },
      { text: "Line 40 shows no wildcard. What wildcard does it use?", ask: "Wildcard", check: (t) => need(is.ip(t.reply, "0.0.0.0"), "A single address (the host keyword, or no wildcard in a standard ACL) means 0.0.0.0: every bit must match.") },
      { text: "Which wildcard matches 192.168.4.0/22?", ask: "Wildcard", check: (t) => need(is.ip(t.reply, "0.0.3.255"), "255.255.255.255 minus the mask 255.255.252.0 gives 0.0.3.255.") },
      { text: "Which wildcard matches 172.20.32.0/19?", ask: "Wildcard", check: (t) => need(is.ip(t.reply, "0.0.31.255"), "/19 is 255.255.224.0; 255 - 224 = 31, so 0.0.31.255.") },
      { text: "How many source addresses may SSH out through ACL 110?", ask: "Number", check: (t) => need(is.num(t.reply, 4), "0.0.0.3 lets the last 2 bits vary: 10.0.0.0 to 10.0.0.3, four addresses.") },
    ],
    answers: { 0: "10.1.1.16 to 10.1.1.31", 1: "No, it falls to the implicit deny", 2: "0.0.0.0", 3: "0.0.3.255", 4: "0.0.31.255", 5: "4" },
    teach: "In a wildcard mask a 0 bit must match and a 1 bit can be anything. For a subnet the wildcard is 255.255.255.255 minus the mask (/24 is 0.0.0.255, /30 is 0.0.0.3). host A.B.C.D means wildcard 0.0.0.0, and any means 0.0.0.0 255.255.255.255. Every ACL ends with an implicit deny any.",
  }),
  ex({
    id: "ex-interface-errors", title: "Interface errors: what each counter means",
    cmds: ["show interfaces", "CRC", "runts", "giants", "collisions", "late collision"],
    intro: "Users behind SW2 say the network is slow. The counters on both ends of the SW1 to SW2 link were cleared, then 24 pings crossed it. Parts of the output are left out.",
    exhibit: `SW1#show interfaces fa0/24
FastEthernet0/24 is up, line protocol is up (connected)
  Full-duplex, 100Mb/s, media type is 10/100BaseTX
     24 packets input, 2736 bytes, 0 no buffer
     3 runts, 0 giants, 0 throttles
     8 input errors, 5 CRC, 0 frame, 0 overrun, 0 ignored
     24 packets output, 2736 bytes, 0 underruns
     0 output errors, 0 collisions, 0 interface resets
     0 babbles, 0 late collision, 0 deferred

SW2#show interfaces fa0/24
FastEthernet0/24 is up, line protocol is up (connected)
  Half-duplex, 100Mb/s, media type is 10/100BaseTX
     24 packets input, 2736 bytes, 0 no buffer
     0 runts, 0 giants, 0 throttles
     0 input errors, 0 CRC, 0 frame, 0 overrun, 0 ignored
     24 packets output, 2736 bytes, 0 underruns
     0 output errors, 7 collisions, 0 interface resets
     0 babbles, 5 late collision, 0 deferred`,
    tasks: [
      { text: "What is wrong with this link?", choices: ["A duplex mismatch: SW1 runs full duplex, SW2 half", "A speed mismatch", "A bad cable", "An MTU mismatch"], check: pick("A duplex mismatch: SW1 runs full duplex, SW2 half", "The speeds match (100 Mb/s) and the link is up, but one end is Full-duplex and the other Half-duplex.") },
      { text: "Why does SW2 count late collisions?", choices: ["It is half duplex and SW1 keeps sending while SW2 is already well into a frame", "Its cable is too long", "It receives frames larger than 1518 bytes", "Its output queue is full"], check: pick("It is half duplex and SW1 keeps sending while SW2 is already well into a frame", "A half-duplex port treats incoming traffic as a collision. One detected after the first 64 bytes is a late collision, which on a short link points to a duplex mismatch.") },
      { text: "Why does SW1 count runts and CRC errors?", choices: ["SW2 stops sending when it sees a collision, so SW1 receives cut-off frames", "SW1's cable is damaged", "SW1 receives jumbo frames", "SW1 is overloaded"], check: pick("SW2 stops sending when it sees a collision, so SW1 receives cut-off frames", "A runt is shorter than 64 bytes; a frame cut off in the middle also fails its FCS check, so it counts as a CRC error. Input errors add them up.") },
      { text: "How many input errors does SW1 show, and what do they include here?", choices: ["8: the 3 runts and the 5 CRC errors", "5: only the CRC errors", "3: only the runts", "24: every packet received"], check: pick("8: the 3 runts and the 5 CRC errors", "Input errors is the total of the receive-side errors: runts, giants, CRC, frame, overrun and ignored.") },
      { text: "On another link both ends run full duplex, there are no collisions, but CRC errors keep rising. Most likely cause?", choices: ["A damaged cable or interference", "A duplex mismatch", "Too many VLANs on the trunk", "STP blocking the port"], check: pick("A damaged cable or interference", "CRC errors without collisions on a full-duplex link point to the physical layer: the cable, a connector or electrical noise.") },
      { text: "Which counter rises when a port receives frames larger than it accepts?", choices: ["giants", "runts", "late collision", "underruns"], check: pick("giants", "Giants are frames above the maximum size (1518 bytes, or the configured MTU); runts are below 64 bytes.") },
    ],
    answers: { 0: "A duplex mismatch: SW1 runs full duplex, SW2 half", 1: "It is half duplex and SW1 keeps sending while SW2 is already well into a frame", 2: "SW2 stops sending when it sees a collision, so SW1 receives cut-off frames", 3: "8: the 3 runts and the 5 CRC errors", 4: "A damaged cable or interference", 5: "giants" },
    teach: "Reading show interfaces: runts (frames under 64 bytes), giants (over the maximum size), CRC (the frame check sequence failed), input errors (the total of those and similar), collisions and late collisions (only on half duplex; late ones, after 64 bytes, usually mean a duplex mismatch), output errors and interface resets. A duplex mismatch shows late collisions on the half-duplex end and runts and CRC errors on the full-duplex end. CRC errors with no collisions point to cabling or interference. Fix a mismatch by setting both ends to auto, or both to the same fixed speed and duplex, then clear counters and watch.",
  }),
  ex({
    id: "ex-nat-terms", title: "NAT terms: inside local, inside global",
    cmds: ["inside local", "inside global", "outside local", "outside global", "show ip nat translations"],
    intro: "R1 connects a small office (192.168.1.0/24) to the Internet. PC1 (192.168.1.10) has just pinged 8.8.8.8.",
    exhibit: `R1#show running-config | include nat|access-list
 ip nat inside
 ip nat outside
ip nat inside source list 1 interface GigabitEthernet0/1 overload
ip nat inside source static 192.168.1.100 203.0.113.4
access-list 1 permit 192.168.1.0 0.0.0.255

R1#show ip nat translations
Pro  Inside global         Inside local          Outside local         Outside global
---  203.0.113.4           192.168.1.100         ---                   ---
icmp 203.0.113.2:1         192.168.1.10:1        8.8.8.8:1             8.8.8.8:1`,
    tasks: [
      { text: "In the second translation, which address is the inside local?", ask: "Address", check: (t) => need(is.ip(t.reply.split(":")[0], "192.168.1.10"), "Inside local: the inside host's own (private) address, as the inside network sees it.") },
      { text: "Which address does 8.8.8.8 see PC1's ping coming from?", ask: "Address", check: (t) => need(is.ip(t.reply.split(":")[0], "203.0.113.2"), "Inside global: the inside host as the outside sees it. With overload on G0/1 it is G0/1's own address.") },
      { text: "What is the :1 after the addresses?", choices: ["The ICMP identifier, which PAT uses like a port number to keep inside hosts apart", "The number of packets", "The VLAN", "The ACL line that matched"], check: pick("The ICMP identifier, which PAT uses like a port number to keep inside hosts apart", "With PAT many inside hosts share one inside global address; the port (or ICMP ID) tells their translations apart.") },
      { text: "Which translation is there even when nobody sends traffic?", choices: ["The first one (static NAT for 192.168.1.100)", "The second one (PAT for PC1)", "Both", "Neither"], check: pick("The first one (static NAT for 192.168.1.100)", "Static entries are permanent, which is what lets outside hosts reach the server first. Dynamic and PAT entries are created by traffic and time out.") },
      { text: "Why are outside local and outside global the same (8.8.8.8)?", choices: ["R1 does not translate the outside address, only the inside source", "8.8.8.8 is a private address", "PAT always copies them", "The ping failed"], check: pick("R1 does not translate the outside address, only the inside source", "ip nat inside source translates inside addresses; the outside host keeps its own address on both sides.") },
      { text: "Someone on the Internet opens a connection to 203.0.113.4. Which inside host receives it?", ask: "Address", check: (t) => need(is.ip(t.reply, "192.168.1.100"), "The static entry maps 203.0.113.4 (inside global) to 192.168.1.100 (inside local) in both directions.") },
    ],
    answers: { 0: "192.168.1.10", 1: "203.0.113.2", 2: "The ICMP identifier, which PAT uses like a port number to keep inside hosts apart", 3: "The first one (static NAT for 192.168.1.100)", 4: "R1 does not translate the outside address, only the inside source", 5: "192.168.1.100" },
    teach: "NAT terms: inside local (an inside host's address inside, usually private), inside global (the same host as the outside sees it), outside local and outside global (an outside host's address as seen inside and outside; the same unless the outside is translated too). Static NAT is a fixed one-to-one entry, so outside hosts can start connections to it. Dynamic NAT takes addresses from a pool. PAT (overload) shares one address among many hosts, telling them apart by port or ICMP ID.",
  }),
];
