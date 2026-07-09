/**
 * Built-in starter workspace shown in the Project explorer on first launch.
 * Mimics a real board folder (Powerboard) with subfolders and `.sim` files so
 * LTspice users land in a familiar project tree instead of an empty prompt.
 */

import { EXAMPLE_CIRCUITS } from "../examples/circuits";
import type { ProjectNode } from "./types";
import type { SchematicDocument } from "../store/useSchematic";

export const DEFAULT_WORKSPACE_ID = "workspace://Powerboard";
export const DEFAULT_WORKSPACE_NAME = "Powerboard";

export interface WorkspaceFile {
  path: string;
  name: string;
  /** JSON body for `.sim` files; ASC text for `.asc` imports. */
  contents: string;
  kind: "sim" | "asc";
}

function simDocFromExample(id: string): SchematicDocument {
  const ex = EXAMPLE_CIRCUITS.find((c) => c.id === id);
  if (!ex) {
    return { components: [], wires: [], probes: [], netLabels: [], directives: [] };
  }
  return {
    components: ex.components,
    wires: ex.wires,
    probes: [],
    netLabels: [],
    directives: [],
  };
}

function simJson(doc: SchematicDocument): string {
  return JSON.stringify(
    {
      app: "Tau",
      version: 1,
      components: doc.components,
      wires: doc.wires,
      probes: doc.probes ?? [],
      netLabels: doc.netLabels ?? [],
      directives: doc.directives ?? [],
    },
    null,
    2,
  );
}

const ROOT = DEFAULT_WORKSPACE_ID;

/** Seed files for the default Powerboard workspace. */
export function defaultWorkspaceFiles(): WorkspaceFile[] {
  return [
    {
      path: `${ROOT}/LED Board/rc-charging.sim`,
      name: "rc-charging.sim",
      kind: "sim",
      contents: simJson(simDocFromExample("rc.v1")),
    },
    {
      path: `${ROOT}/LED Board/rc-lowpass.sim`,
      name: "rc-lowpass.sim",
      kind: "sim",
      contents: simJson(simDocFromExample("rc-lpf.v1")),
    },
    {
      path: `${ROOT}/Charging Circuit/voltage-divider.sim`,
      name: "voltage-divider.sim",
      kind: "sim",
      contents: simJson(simDocFromExample("divider.v1")),
    },
    {
      path: `${ROOT}/Charging Circuit/rlc-series.sim`,
      name: "rlc-series.sim",
      kind: "sim",
      contents: simJson(simDocFromExample("rlc.v1")),
    },
    {
      path: `${ROOT}/Analog/non-inverting-amp.sim`,
      name: "non-inverting-amp.sim",
      kind: "sim",
      contents: simJson(simDocFromExample("opamp-noninv.v1")),
    },
    {
      path: `${ROOT}/Analog/inverting-amp.sim`,
      name: "inverting-amp.sim",
      kind: "sim",
      contents: simJson(simDocFromExample("opamp-inv.v1")),
    },
    {
      path: `${ROOT}/Power Stage/class-d.sim`,
      name: "class-d.sim",
      kind: "sim",
      contents: simJson(simDocFromExample("classd.v1")),
    },
  ];
}

/** Build a ProjectNode tree from the seeded workspace files. */
export function defaultWorkspaceTree(files: WorkspaceFile[] = defaultWorkspaceFiles()): ProjectNode[] {
  type DirAcc = { name: string; path: string; children: Map<string, DirAcc | ProjectNode> };
  const root: DirAcc = { name: DEFAULT_WORKSPACE_NAME, path: ROOT, children: new Map() };

  for (const file of files) {
    const rel = file.path.slice(ROOT.length + 1);
    const parts = rel.split("/");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      const childPath = `${cur.path}/${part}`;
      let next = cur.children.get(part);
      if (!next || !("children" in next)) {
        next = { name: part, path: childPath, children: new Map() };
        cur.children.set(part, next);
      }
      cur = next as DirAcc;
    }
    const fileName = parts[parts.length - 1];
    if (fileName === ".keep") continue;
    cur.children.set(fileName, { name: fileName, path: file.path, kind: "file" });
  }

  const toNodes = (acc: DirAcc): ProjectNode[] => {
    const nodes: ProjectNode[] = [];
    for (const child of acc.children.values()) {
      if ("kind" in child && child.kind === "file") {
        nodes.push(child);
      } else {
        const dir = child as DirAcc;
        nodes.push({ name: dir.name, path: dir.path, kind: "dir", children: toNodes(dir) });
      }
    }
    return nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  };

  return toNodes(root);
}

export function isWorkspacePath(path: string): boolean {
  return path.startsWith("workspace://");
}
