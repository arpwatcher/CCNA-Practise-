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
];
