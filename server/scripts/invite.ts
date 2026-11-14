/* Invite codes. Each code is one student account: signing in again with the same code shows the same lectures. With
   SIGN_IN=email (phase 4) a code is used once, with the student's email, and the email signs in after that.
     npm run invite -- add <code> [name]    add a code
     npm run invite -- new [name]           add a random code and print it
     npm run invite -- list                 list the codes */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config";
import { Store, randomId } from "../src/db";

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
const store = new Store(path.join(config.dataDir, "sidenote.db"));
const [cmd, ...rest] = process.argv.slice(2);

if (cmd === "add" && rest[0]) { const u = store.addInviteCode(rest[0], rest.slice(1).join(" ")); console.log(`${u.invite_code}  ${u.name || "(no name yet)"}`); }
else if (cmd === "new") { const code = randomId(4) + "-" + randomId(4); const u = store.addInviteCode(code, rest.join(" ")); console.log(u.invite_code); }
else if (cmd === "list") { for (const u of store.listUsers()) console.log(`${u.invite_code}  ${u.name || "(no name yet)"}  ${u.email || "(not used with an email yet)"}`); }
else { console.log("npm run invite -- add <code> [name] | new [name] | list"); process.exitCode = 1; }
store.close();
