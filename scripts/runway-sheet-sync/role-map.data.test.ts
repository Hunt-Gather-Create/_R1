/**
 * The shipped role map holds only the _R1#203 staffing table: every binding
 * renders a role-tagged resource, and every label outside the table refuses.
 */
import { describe, expect, it } from "vitest";
import { validateRoleTagOnResources } from "../../src/lib/runway/operations-utils";
import { checkBinding, planPeople, ROLE_MAP, type RoleBinding } from "./role-map";

const REGISTERED = ["beyond-petro", "lppc", "nfm", "soundly"];

function allBindings(): Array<[string, RoleBinding]> {
  return Object.entries(ROLE_MAP).flatMap(([slug, m]) => [
    [slug, m.clientResource] as [string, RoleBinding],
    ...Object.values(m.labels).flatMap((b) => [b].flat().map((x) => [slug, x] as [string, RoleBinding])),
  ]);
}

describe("the shipped role map", () => {
  it("registers exactly the four clients, each with Kathy as account manager", () => {
    expect(Object.keys(ROLE_MAP).sort()).toEqual(REGISTERED);
    for (const slug of REGISTERED) expect(ROLE_MAP[slug].accountManager).toBe("Kathy");
  });

  it("every binding passes checkBinding and renders a resources string that passes validateRoleTagOnResources", () => {
    const bindings = allBindings();
    expect(bindings.length).toBeGreaterThan(60);
    for (const [slug, b] of bindings) {
      expect(checkBinding(b, slug)).toBe(b);
      expect(validateRoleTagOnResources(`${b.roleTag}: ${b.person}`)).toEqual({ ok: true });
    }
  });

  it("every label on every client plans a resources string that passes validateRoleTagOnResources", () => {
    for (const [slug, m] of Object.entries(ROLE_MAP)) {
      for (const label of [...m.clientLabels, ...Object.keys(m.labels)]) {
        const plan = planPeople(label, slug, ROLE_MAP);
        expect(plan.kind, `${slug} ${label}`).toBe("planned");
        if (plan.kind === "planned") expect(validateRoleTagOnResources(plan.resources)).toEqual({ ok: true });
      }
    }
  });

  it("Civ + each client label binds AM: Kathy, then that client's resource", () => {
    expect(planPeople("Civ + Beyond Petro", "beyond-petro", ROLE_MAP)).toEqual({
      kind: "planned",
      owner: "Kathy",
      resources: "AM: Kathy, Client: Beyond Petro",
    });
    expect(planPeople("Civ + LPPC", "lppc", ROLE_MAP)).toMatchObject({ resources: "AM: Kathy, Client: LPPC" });
    expect(planPeople("Civ + NFM", "nfm", ROLE_MAP)).toMatchObject({ resources: "AM: Kathy, Client: NFM" });
    expect(planPeople("Civ + Soundly", "soundly", ROLE_MAP)).toMatchObject({ resources: "AM: Kathy, Client: Soundly" });
  });

  it("Josefina binds on soundly only", () => {
    expect(planPeople("Josefina", "soundly", ROLE_MAP)).toEqual({ kind: "planned", owner: "Josefina", resources: "Dev: Josefina" });
    for (const slug of ["beyond-petro", "lppc", "nfm"]) {
      expect(planPeople("Josefina", slug, ROLE_MAP)).toEqual({ kind: "refused", unmapped: ["Josefina"] });
    }
  });

  it.each(REGISTERED)("a label outside the table is still refused on %s", (slug) => {
    expect(planPeople("Copywriting", slug, ROLE_MAP)).toEqual({ kind: "refused", unmapped: ["Copywriting"] });
    expect(planPeople("Design, Strategy", slug, ROLE_MAP)).toEqual({ kind: "refused", unmapped: ["Strategy"] });
  });

  it("a Civ label for another client is refused", () => {
    expect(planPeople("Civ + BP", "lppc", ROLE_MAP)).toEqual({ kind: "refused", unmapped: ["Civ + BP"] });
  });
});
