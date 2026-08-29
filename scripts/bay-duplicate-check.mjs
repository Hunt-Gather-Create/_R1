#!/usr/bin/env node
/**
 * bay-duplicate-check.mjs — dispatch-side duplicate-delivery detector.
 *
 * WHY THIS EXISTS
 * On 2026-08-29 a dispatch was SENT ONCE and DELIVERED TWICE. The event id
 * appears exactly once on the relay; the bot's second turn was handed that same
 * event id and timestamp, byte identical. The duplication sits between the relay
 * and the agent runtime and neither seat can see into that layer.
 *
 * The wasted run is not the risk. The risk is that a replayed turn lands on a
 * tree where the fix ALREADY EXISTS, so a before-state can never be observed,
 * and the run returns all-green while proving nothing. Under the fleet's
 * standard evidence bar — plant the mutation, observe the RED, restore, observe
 * the GREEN — a silent replay produces something that reads exactly like a
 * correct proof. Every mutation proof and non-vacuity control is in that class.
 *
 * The first mitigation was to tell the bot to report a duplicate arrival.
 * Overwatch named its limit correctly: that is a DETECTOR, not a control, and it
 * depends on the receiver noticing and volunteering. A detector that can fail
 * silent has the same problem as the thing it detects. So the signal has to fire
 * at the DISPATCHING end, which is here. Filed as buzz#23.
 *
 * WHAT IT DOES
 * Reads a room's history and counts BOTH sides: dispatches I sent, and ACKs and
 * done-reports the bot returned. It flags only the EXCESS. Counting one side is
 * not enough, and the first version of this script was wrong for exactly that
 * reason: it flagged _R1#108 on three ACKs when three dispatches had genuinely
 * gone out across eleven review rounds. Legitimate re-dispatch and silent replay
 * are indistinguishable unless you count both sides.
 *
 * It asks the relay, not a local ledger, because a ledger this seat maintains by
 * hand is one forgotten write from lying.
 *
 * WHAT IT DOES NOT DO
 * It cannot see the delivery layer, so it detects the SYMPTOM, not the event. A
 * replay that produced no second report is invisible to it. And a dispatch older
 * than the read window is invisible too, which makes a legitimate reply look
 * excessive; that case is labelled rather than hidden, because a tool that
 * silently converts "I could not see it" into "it did not happen" is the same
 * defect it exists to catch. It prints counts, not a verdict.
 *
 * Usage:  node scripts/bay-duplicate-check.mjs <room-uuid> [limit]
 * Needs BUZZ_PRIVATE_KEY in the environment. Never prints it.
 */

import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const [room, limitArg] = process.argv.slice(2);

if (!room) {
  console.error("usage: node scripts/bay-duplicate-check.mjs <room-uuid> [limit]");
  process.exit(2);
}
if (!process.env.BUZZ_PRIVATE_KEY) {
  console.error("BUZZ_PRIVATE_KEY is not set. Confirm presence, never print the value.");
  process.exit(3);
}

const limit = Number.parseInt(limitArg ?? "80", 10);
const buzz = join(homedir(), ".local", "bin", "buzz");

let messages;
try {
  const raw = execFileSync(
    buzz,
    ["messages", "get", "--channel", room, "--limit", String(limit)],
    { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 },
  );
  messages = JSON.parse(raw);
} catch (err) {
  // Fail loudly. A checker that returns "no duplicates" because it could not
  // read the room is worse than no checker, for the same reason the thing it
  // checks for is dangerous: it looks like a clean result.
  console.error(`could not read room ${room}: ${err.message}`);
  process.exit(4);
}

// Ticket refs look like _R1#111. The kind of line matters: an ACK and a
// done-report are different events and duplicating either one means something
// different, so they are counted separately rather than lumped.
const TICKET = /\b(_R1#\d+)/;
const kindOf = (body) => {
  const head = body.trim().slice(0, 160);
  if (/\bACK\b/.test(head)) return "ACK";
  if (/\bdone\b/i.test(head)) return "done";
  return null;
};

// Counting repeats alone is not enough, and the first version of this script was
// wrong for exactly that reason: it flagged _R1#108 on three ACKs when I had
// dispatched it three times across eleven review rounds. Legitimate re-dispatch
// and silent replay look identical if you only count one side.
//
// The distinguishing fact is on MY side of the room: a replay produces an ACK
// with no dispatch behind it. So count both, and flag only the excess.
const DISPATCH = /\bDISPATCH\s+(_R1#\d+)/;

const dispatches = new Map(); // ticket -> count sent by me
const replies = new Map(); // "ticket kind bot" -> [{at,id}]

for (const m of messages) {
  const dispatched = m.content.match(DISPATCH)?.[1];
  if (dispatched) {
    dispatches.set(dispatched, (dispatches.get(dispatched) ?? 0) + 1);
    continue;
  }
  const kind = kindOf(m.content);
  if (!kind) continue;
  const ticket = m.content.match(TICKET)?.[1];
  if (!ticket) continue;
  const key = `${ticket}\u0000${kind}\u0000${m.pubkey.slice(0, 8)}`;
  if (!replies.has(key)) replies.set(key, []);
  replies.get(key).push({ at: new Date(m.created_at * 1000).toISOString(), id: m.id.slice(0, 12) });
}

const suspects = [];
for (const [key, hits] of replies) {
  const [ticket, kind, bot] = key.split("\u0000");
  const sent = dispatches.get(ticket) ?? 0;
  // A dispatch older than the window is invisible, so sent can undercount. Say
  // so rather than let an unreadable window read as a finding.
  const windowed = sent === 0;
  if (hits.length > Math.max(sent, 1)) suspects.push({ ticket, kind, bot, hits, sent, windowed });
}

console.log(
  `room ${room}: read ${messages.length} messages, ` +
    `${dispatches.size} ticket(s) dispatched, ${replies.size} reply group(s)`,
);

if (suspects.length === 0) {
  console.log("no excess ACK or done-report in this window.");
  console.log("NOT a guarantee: a replay that produced no second report is invisible here.");
  process.exit(0);
}

console.log(`\nDUPLICATE DELIVERY SUSPECTED, ${suspects.length} case(s):\n`);
for (const s of suspects) {
  console.log(
    `  ${s.ticket} ${s.kind} from ${s.bot} — ${hitWord(s.hits.length)}, ` +
      `${s.sent} dispatch(es) visible${s.windowed ? " (none in window, may predate it)" : ""}`,
  );
  for (const h of s.hits) console.log(`      ${h.at}  event ${h.id}`);
}
console.log(
  "\nBefore accepting any before-state evidence from these tickets, confirm the RED was\n" +
    "observed in the SAME run that reported the GREEN. Under replay it cannot have been.",
);
process.exit(1);

function hitWord(n) {
  return `${n} ${n === 1 ? "reply" : "replies"}`;
}
