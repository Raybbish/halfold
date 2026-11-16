/* Video links (DESIGN.md, 视频链接): the server opens a link a student pasted, so it must never be used to reach the
   machine itself or the network it sits in (the cloud metadata address 169.254.169.254, a database on 10.x, ...).
   Checking the pasted link is not enough: a public page can redirect to an inside address, and yt-dlp requests other
   addresses it finds (the video file, the pieces of a playlist). So all of yt-dlp's traffic goes through GuardProxy, a
   proxy on 127.0.0.1 that resolves each host once, refuses it if any of its addresses is not public, and connects to
   the address it resolved (a second lookup could answer differently). */
import http from "node:http";
import net from "node:net";
import dns from "node:dns/promises";

const v4 = new net.BlockList(), v6 = new net.BlockList();
for (const [a, p] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) v4.addSubnet(a, p, "ipv4");
for (const [a, p] of [["::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16],
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]] as const) v6.addSubnet(a, p, "ipv6");

/* The eight 16-bit words of an IPv6 address (already checked by net.isIPv6), including a dotted IPv4 tail. */
function words6(ip: string): number[] {
  let s = ip;
  const tail: number[] = [], m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) { const b = m[2].split(".").map(Number); tail.push(b[0] << 8 | b[1], b[2] << 8 | b[3]); s = m[1].endsWith("::") ? m[1] : m[1].slice(0, -1); }
  const [head, rest] = s.split("::"), hex = (x: string) => x ? x.split(":").map(p => parseInt(p, 16)) : [];
  if (rest === undefined) return [...hex(head), ...tail];
  const h = hex(head), r = hex(rest);
  return [...h, ...Array(8 - h.length - r.length - tail.length).fill(0), ...r, ...tail];
}

/* True for an address on the public internet. An IPv6 address that carries an IPv4 one (::ffff:a.b.c.d, NAT64
   64:ff9b::/96) is judged by the IPv4 address. Anything that is not an address is not public. */
export function isPublicAddress(ip: string): boolean {
  const a = ip.split("%")[0];
  if (net.isIPv4(a)) return !v4.check(a, "ipv4");
  if (!net.isIPv6(a)) return false;
  const w = words6(a);
  const mapped = w.slice(0, 5).every(x => x === 0) && w[5] === 0xffff, nat64 = w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every(x => x === 0);
  if (mapped || nat64) return isPublicAddress(`${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`);
  return !v6.check(a, "ipv6");
}

const FULL_LINK = "Paste the full link, starting with https://";
const NOT_PUBLIC = "Only public links can be opened. This one points to a private network.";

/* What is wrong with a pasted link, in a sentence for the student; null when it can be tried. A host name that resolves
   inside is caught later, by the proxy. */
export function linkProblem(raw: string): string | null {
  const s = raw.trim();
  if (!s) return "Paste the link to the lecture video.";
  if (s.length > 2000) return "This link is too long. Paste the link to the video page itself.";
  let u: URL;
  try { u = new URL(s); } catch { return FULL_LINK; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return FULL_LINK;
  if (u.port && u.port !== "80" && u.port !== "443") return "Only links on the usual web ports (80 and 443) can be opened.";
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return NOT_PUBLIC;
  if (net.isIP(host) && !isPublicAddress(host)) return NOT_PUBLIC;
  return null;
}

export interface GuardOptions {
  allow?: (ip: string) => boolean;                 // default: isPublicAddress
  ports?: number[] | null;                         // default 80 and 443; null = any (tests)
  lookup?: (host: string) => Promise<string[]>;    // default: the system resolver, every address
}

const systemLookup = async (host: string) => (await dns.lookup(host, { all: true, verbatim: true })).map(a => a.address);
/* The proxy's own refusals say so in the status line, which yt-dlp prints: a site's 403 means something else (ytdlp.ts classify). */
type Refusal = { status: number; phrase?: string };
const NOT_PUBLIC_REFUSAL: Refusal = { status: 403, phrase: "Not A Public Address" }, PORT_REFUSAL: Refusal = { status: 403, phrase: "Port Not Allowed" };
const phrase = (r: Refusal) => r.phrase ?? http.STATUS_CODES[r.status] ?? "";
const refuse = (socket: net.Socket, r: Refusal) =>
  socket.end(`HTTP/1.1 ${r.status} ${phrase(r)}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);

/* Connects to the first of the checked addresses that answers (a host may list an IPv6 address first on a server
   without IPv6, or one that is down). */
function connectAny(ips: string[], port: number): Promise<net.Socket> {
  return new Promise((ok, bad) => {
    let i = 0;
    const next = (err?: Error) => {
      if (i >= ips.length) return bad(err ?? new Error("no address"));
      const s = net.connect({ host: ips[i++], port, timeout: 10_000 });
      /* Only these listeners are removed: a socket has listeners of its own. */
      const off = () => { s.off("error", fail); s.off("timeout", timedOut); s.off("connect", connected); };
      const fail = (e: Error) => { off(); s.destroy(); next(e); };
      const timedOut = () => fail(new Error("timed out"));
      const connected = () => { off(); s.setTimeout(0); ok(s); };
      s.on("error", fail); s.on("timeout", timedOut); s.on("connect", connected);
    };
    next();
  });
}

/* An HTTP proxy for yt-dlp (--proxy): CONNECT for https, absolute-form requests for http. */
export class GuardProxy {
  private readonly server = http.createServer();
  private readonly sockets = new Set<net.Socket>();
  private readonly allow: (ip: string) => boolean;
  private readonly ports: number[] | null;
  private readonly lookup: (host: string) => Promise<string[]>;

  constructor(o: GuardOptions = {}) {
    this.allow = o.allow ?? isPublicAddress;
    this.ports = o.ports === undefined ? [80, 443] : o.ports;
    this.lookup = o.lookup ?? systemLookup;
    this.server.on("connection", s => { this.sockets.add(s); s.on("close", () => this.sockets.delete(s)); });
    this.server.on("connect", (req: http.IncomingMessage, client: net.Socket, head: Buffer) => { void this.tunnel(req, client, head); });
    this.server.on("request", (req, res) => { void this.forward(req, res); });
  }

  /* Starts on a free port of 127.0.0.1 and returns the proxy's address for --proxy. */
  async listen(): Promise<string> {
    await new Promise<void>((ok, bad) => { this.server.once("error", bad); this.server.listen(0, "127.0.0.1", () => ok()); });
    return `http://127.0.0.1:${(this.server.address() as net.AddressInfo).port}`;
  }

  async close() {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>(r => this.server.close(() => r()));
  }

  /* The address to connect to, or the status to refuse with. */
  private async resolve(host: string, port: number): Promise<{ ips: string[] } | Refusal> {
    if (this.ports && !this.ports.includes(port)) return PORT_REFUSAL;
    const h = host.replace(/^\[|\]$/g, "");
    let ips: string[] = [];
    if (net.isIP(h)) ips = [h];
    else { try { ips = await this.lookup(h); } catch { /* does not resolve */ } }
    if (!ips.length) return { status: 502 };
    if (ips.some(ip => !this.allow(ip))) return NOT_PUBLIC_REFUSAL;
    return { ips };
  }

  private async tunnel(req: http.IncomingMessage, client: net.Socket, head: Buffer) {
    client.on("error", () => client.destroy());
    const m = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(req.url || "");
    if (!m) return refuse(client, { status: 400 });
    const port = Number(m[2]), where = await this.resolve(m[1], port);
    if ("status" in where) return refuse(client, where);
    let upstream: net.Socket;
    try { upstream = await connectAny(where.ips, port); } catch { return refuse(client, { status: 502 }); }
    if (client.destroyed) return upstream.destroy();
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    upstream.pipe(client); client.pipe(upstream);
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  }

  private async forward(req: http.IncomingMessage, res: http.ServerResponse) {
    const done = (r: Refusal) => { if (!res.headersSent) res.writeHead(r.status, phrase(r), { "Content-Length": "0", Connection: "close" }); res.end(); };
    let u: URL;
    try { u = new URL(req.url || ""); } catch { return done({ status: 400 }); }
    if (u.protocol !== "http:") return done({ status: 400 });
    const port = Number(u.port || 80), where = await this.resolve(u.hostname, port);
    if ("status" in where) return done(where);
    const headers: http.OutgoingHttpHeaders = { ...req.headers, host: u.host };
    delete headers["proxy-connection"]; delete headers["proxy-authorization"]; delete headers.connection;
    let sock: net.Socket;
    try { sock = await connectAny(where.ips, port); } catch { return done({ status: 502 }); }
    const up = http.request({ createConnection: () => sock, method: req.method, path: u.pathname + u.search, headers, setHost: false }, r => {
      res.writeHead(r.statusCode || 502, r.headers); r.pipe(res);
    });
    up.on("error", () => { if (res.headersSent) res.destroy(); else done({ status: 502 }); });
    res.on("close", () => up.destroy());
    req.pipe(up);
  }
}
