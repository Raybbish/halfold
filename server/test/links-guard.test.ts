/* Video links (DESIGN.md, 视频链接): which addresses the server may reach for a student's link, the check on the link
   itself, and the proxy every download goes through. */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { GuardProxy, isPublicAddress, linkProblem } from "../src/links/guard";

test("addresses: private, local and reserved ones are refused, public ones allowed", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "240.0.0.1", "255.255.255.255", "192.0.2.1", "198.51.100.7", "203.0.113.9", "198.18.0.1", "192.0.0.8",
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "2001:db8::1", "not an address"])
    assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.63.255.255", "2606:4700::1111", "::ffff:8.8.8.8"])
    assert.equal(isPublicAddress(ip), true, ip);
});

test("link check: only a full http or https link to a public host", () => {
  for (const ok of ["https://www.youtube.com/watch?v=abc", "http://example.com/lecture.mp4", "https://8.8.8.8/x", "  https://vimeo.com/123  "])
    assert.equal(linkProblem(ok), null, ok);
  for (const bad of ["", "youtube.com/watch?v=abc", "ftp://example.com/a.mp4", "file:///etc/passwd", "javascript:alert(1)", "https://localhost/a",
    "http://foo.localhost/", "http://127.0.0.1/", "http://[::1]/", "http://10.0.0.5/", "http://169.254.169.254/latest/meta-data/",
    "http://2130706433/", "http://0x7f.1/", "http://example.com:8080/a.mp4", "https://" + "a".repeat(2000) + ".com/"])
    assert.equal(typeof linkProblem(bad), "string", bad);
});

/* A CONNECT through the proxy: the status it answered, and the socket when it let the tunnel through. */
function connect(proxy: string, target: string) {
  const u = new URL(proxy);
  return new Promise<{ status: number; socket: import("node:net").Socket }>((ok, bad) => {
    const req = http.request({ host: u.hostname, port: u.port, method: "CONNECT", path: target });
    req.on("connect", (res, socket) => ok({ status: res.statusCode!, socket }));
    req.on("error", bad); req.end();
  });
}
/* A plain request through the proxy (absolute-form, as yt-dlp sends http:// links). */
function viaProxy(proxy: string, url: string) {
  const u = new URL(proxy), target = new URL(url);
  return new Promise<{ status: number; body: string }>((ok, bad) => {
    const req = http.request({ host: u.hostname, port: u.port, path: url, headers: { Host: target.host } }, res => {
      let body = ""; res.setEncoding("utf8"); res.on("data", d => body += d); res.on("end", () => ok({ status: res.statusCode!, body }));
    });
    req.on("error", bad); req.end();
  });
}
async function target() {
  const server = http.createServer((req, res) => res.end("hello " + req.headers.host + " " + req.url));
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  return { server, port: (server.address() as AddressInfo).port };
}

test("proxy: refuses local addresses, names that point inside, other ports, and names that do not resolve", async t => {
  const names: Record<string, string[]> = { "inside.test": ["10.0.0.5"], "pub.test": ["8.8.8.8"], "both.test": ["8.8.8.8", "10.0.0.5"] };
  const guard = new GuardProxy({ lookup: async h => names[h] ?? [] }), proxy = await guard.listen();
  t.after(() => guard.close());
  assert.match(proxy, /^http:\/\/127\.0\.0\.1:\d+$/);
  for (const to of ["127.0.0.1:443", "[::1]:443", "inside.test:443", "both.test:443", "pub.test:8443", "pub.test:22"]) {
    const r = await connect(proxy, to); r.socket.destroy();
    assert.equal(r.status, 403, to);
  }
  assert.equal((await connect(proxy, "nowhere.test:443").then(r => { r.socket.destroy(); return r; })).status, 502);
  for (const url of ["http://127.0.0.1/", "http://inside.test/", "http://169.254.169.254/latest/meta-data/", "http://pub.test:8080/"])
    assert.equal((await viaProxy(proxy, url)).status, 403, url);
});

test("proxy: tunnels and forwards to the address it resolved, keeping the name the client asked for", async t => {
  const { server, port } = await target();
  const asked: string[] = [];
  const guard = new GuardProxy({ allow: () => true, ports: null, lookup: async h => { asked.push(h); return ["127.0.0.1"]; } }), proxy = await guard.listen();
  t.after(async () => { await guard.close(); server.close(); });

  const c = await connect(proxy, `pub.test:${port}`);
  assert.equal(c.status, 200);
  const reply = await new Promise<string>(ok => {
    let got = ""; c.socket.setEncoding("utf8"); c.socket.on("data", d => got += d); c.socket.on("end", () => ok(got));
    c.socket.write(`GET /tunnel HTTP/1.1\r\nHost: pub.test\r\nConnection: close\r\n\r\n`);
  });
  assert.match(reply, /hello pub\.test \/tunnel/);

  const r = await viaProxy(proxy, `http://pub.test:${port}/plain?x=1`);
  assert.equal(r.status, 200); assert.equal(r.body, `hello pub.test:${port} /plain?x=1`);
  assert.deepEqual(asked, ["pub.test", "pub.test"]);
});

test("proxy: when the first address does not answer, the next one is tried", async t => {
  const { server, port } = await target();   // listens on 127.0.0.1 only, so ::1 refuses the connection
  const guard = new GuardProxy({ allow: () => true, ports: null, lookup: async () => ["::1", "127.0.0.1"] }), proxy = await guard.listen();
  t.after(async () => { await guard.close(); server.close(); });
  const c = await connect(proxy, `two.test:${port}`); c.socket.destroy();
  assert.equal(c.status, 200);
  const r = await viaProxy(proxy, `http://two.test:${port}/x`);
  assert.equal(r.status, 200); assert.equal(r.body, `hello two.test:${port} /x`);
});
