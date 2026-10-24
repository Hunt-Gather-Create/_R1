/**
 * The one role map for the RESOURCE column, keyed by client slug. Rule R1
 * as amended 2026-10-24: owner and resources come from here and nowhere else.
 *
 * Holds only the staffing table on _R1#203. A label not listed here is a
 * counted refusal sent to review, never a guess.
 */
import type { ClientRoleMap, RoleBinding, RoleMap } from "./role-map";

const AM: RoleBinding = { roleTag: "AM", person: "Kathy" };
const CD: RoleBinding = { roleTag: "CD", person: "Lane" };
const DEV: RoleBinding = { roleTag: "Dev", person: "Leslie" };
const QA: RoleBinding = { roleTag: "QA", person: "Leslie" };
const PM: RoleBinding = { roleTag: "PM", person: "Jason" };

/** Labels every registered client shares. */
const SHARED_LABELS: ClientRoleMap["labels"] = {
  Account: AM,
  Creatives: CD,
  "Design + Creatives": CD,
  Design: CD,
  "Design + QA": [CD, QA],
  Dev: DEV,
  "Dev + QA": DEV,
  "Dev + Design": [DEV, CD],
  QA: QA,
  Lane: CD,
  Leslie: DEV,
  Kathy: AM,
  Jason: PM,
};

/** One client: the shared labels, a "Civ + <label>" for each client label, then any client-only labels. */
function client(clientLabels: string[], clientName: string, only: ClientRoleMap["labels"] = {}): ClientRoleMap {
  const clientResource: RoleBinding = { roleTag: "Client", person: clientName };
  const civ = Object.fromEntries(clientLabels.map((l) => [`Civ + ${l}`, [AM, clientResource]]));
  return { accountManager: "Kathy", clientLabels, clientResource, labels: { ...SHARED_LABELS, ...civ, ...only } };
}

export const ROLE_MAP: RoleMap = {
  "beyond-petro": client(["BP", "Beyond Petro"], "Beyond Petro"),
  lppc: client(["LPPC"], "LPPC"),
  nfm: client(["NFM"], "NFM"),
  soundly: client(["Soundly"], "Soundly", { Josefina: { roleTag: "Dev", person: "Josefina" } }),
};
