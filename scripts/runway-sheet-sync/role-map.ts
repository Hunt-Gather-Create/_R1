/**
 * Role map lookup for column J, RESOURCE. Rule R1 as amended 2026-10-24:
 * a label plans owner and resources only through the map; any label the
 * map does not hold is a refusal, and the row plans neither field.
 */
export { ROLE_MAP } from "./role-map.data";

/** One person in one role, rendered into resources as "roleTag: person". */
export interface RoleBinding {
  roleTag: string;
  person: string;
}

export interface ClientRoleMap {
  /** First name of the person who owns a client-resource row. */
  accountManager: string;
  /** Labels in column J that name the client itself, for example "BP". */
  clientLabels: string[];
  /** The resources entry a client-resource row carries, for example Client: BP. */
  clientResource: RoleBinding;
  /** A role or a person's first name, as typed in column J, to the bindings it plans, in order. */
  labels: Record<string, RoleBinding | RoleBinding[]>;
}

/** Keyed by client slug. */
export type RoleMap = Record<string, ClientRoleMap>;

export type PeoplePlan =
  | { kind: "no-label" }
  | { kind: "planned"; owner: string; resources: string }
  | { kind: "refused"; unmapped: string[] };

/** Splits a cell holding more than one label. "+" and arrows stay inside one label. */
const LABEL_SEPARATORS = /[,;/\n]/;
/** Characters that would corrupt a resources string or its role prefix. */
const UNSAFE_IN_BINDING = /[,:\n]|->|→/;

function norm(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The whole cell when the map knows it as one label, else its separated parts. */
export function splitLabels(cell: string, clientMap?: ClientRoleMap): string[] {
  const whole = cell.trim();
  const known = clientMap
    ? [...clientMap.clientLabels, ...Object.keys(clientMap.labels)].map(norm)
    : [];
  if (known.includes(norm(whole))) return [whole];
  return whole
    .split(LABEL_SEPARATORS)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function checkBinding(b: RoleBinding, clientSlug: string): RoleBinding {
  for (const part of [b.roleTag, b.person]) {
    if (!part.trim() || UNSAFE_IN_BINDING.test(part)) {
      throw new Error(
        `ROLE MAP: client "${clientSlug}" has a binding "${b.roleTag}: ${b.person}" that cannot render as a role-tagged resource. Fix role-map.data.ts.`
      );
    }
  }
  return b;
}

/** Every binding a label plans, in map order, each one checked. */
function bindingsFor(bound: RoleBinding | RoleBinding[], clientSlug: string): RoleBinding[] {
  const list = Array.isArray(bound) ? bound : [bound];
  if (list.length === 0) {
    throw new Error(`ROLE MAP: client "${clientSlug}" has a label bound to no role. Fix role-map.data.ts.`);
  }
  return list.map((b) => checkBinding(b, clientSlug));
}

/**
 * Rule R1 as amended: the first binding sets the owner, every binding sets
 * resources, a client label makes the account manager the owner, and any
 * unmapped label refuses the whole row.
 */
export function planPeople(
  resource: string | null,
  clientSlug: string,
  roleMap: RoleMap
): PeoplePlan {
  if (!resource || !resource.trim()) return { kind: "no-label" };
  const clientMap = roleMap[clientSlug];
  const labels = splitLabels(resource, clientMap);
  if (!clientMap) return { kind: "refused", unmapped: labels };

  const byLabel = new Map(Object.entries(clientMap.labels).map(([k, v]) => [norm(k), v]));
  const clientLabels = new Set(clientMap.clientLabels.map(norm));
  const bindings: RoleBinding[] = [];
  const unmapped: string[] = [];
  let clientRow = false;
  for (const label of labels) {
    if (clientLabels.has(norm(label))) {
      clientRow = true;
      bindings.push(checkBinding(clientMap.clientResource, clientSlug));
      continue;
    }
    const bound = byLabel.get(norm(label));
    if (bound) bindings.push(...bindingsFor(bound, clientSlug));
    else unmapped.push(label);
  }
  if (unmapped.length > 0) return { kind: "refused", unmapped };

  const owner = clientRow ? clientMap.accountManager.trim() : bindings[0].person.trim();
  if (!owner || UNSAFE_IN_BINDING.test(owner)) {
    throw new Error(`ROLE MAP: client "${clientSlug}" has no usable accountManager. Fix role-map.data.ts.`);
  }
  const entries = bindings.map((b) => `${b.roleTag.trim()}: ${b.person.trim()}`);
  return { kind: "planned", owner, resources: [...new Set(entries)].join(", ") };
}
