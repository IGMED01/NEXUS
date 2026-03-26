// @ts-check

import { mkdir, readFile, appendFile, readdir, access, rename, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

/** @typedef {"recall" | "teach" | "remember" | "doctor" | "select"} ShellTabId */
/** @typedef {"resilient" | "engram-only" | "local-only"} MemoryBackendMode */
/** @typedef {"text" | "json"} OutputFormat */
/** @typedef {"auto" | "safe"} ShellRenderMode */
/** @typedef {"initial" | "navigation" | "layout" | "manual-clear" | "notice" | "command"} ShellRenderReason */

/**
 * @typedef {{
 *   id: ShellTabId,
 *   label: string,
 *   command: "recall" | "teach" | "remember" | "doctor" | "select"
 * }} ShellTab
 */

/**
 * @typedef {{
 *   project: string,
 *   workspace: string,
 *   memoryBackend: MemoryBackendMode,
 *   format: OutputFormat
 * }} ShellSessionConfig
 */

/**
 * @typedef {{
 *   activeTab: ShellTabId,
  *   selectorIndex: number,
  *   session: ShellSessionConfig,
  *   historyFilePath: string,
 *   telemetryFilePath: string,
  *   commandCount: number,
  *   startedAt: number
 * }} ShellState
 */

/** @typedef {"nexus" | "nexus-recall" | "nexus-teach" | "nexus-remember" | "nexus-select" | "nexus-doctor" | "nexus-version" | "nexus-help" | "skills" | "skill-actions"} ShellMenuSection */

/**
 * @typedef {{
 *   name: string,
 *   status: string,
 *   occurrences: number,
 *   updatedAt: string,
 *   filePath: string
 * }} GeneratedSkillEntry
 */

/**
 * @typedef {{
 *   type: "switch-tab",
 *   tab: ShellTabId
 * } | {
 *   type: "run-cli",
 *   argv: string[],
 *   rawLine: string
 * } | {
 *   type: "run-script",
 *   command: string,
 *   args: string[],
 *   rawLine: string
 * } | {
 *   type: "open-skill-actions",
 *   skill: GeneratedSkillEntry
 * } | {
 *   type: "open-section",
 *   section: ShellMenuSection
 * } | {
 *   type: "refresh-skills"
 * } | {
 *   type: "promote-skill",
 *   skillName: string,
 *   status: "experimental" | "stable"
 * } | {
 *   type: "archive-skill",
 *   skillName: string
 * } | {
 *   type: "show-help"
 * } | {
 *   type: "show-skill",
 *   skill: GeneratedSkillEntry
 * } | {
 *   type: "show-skill-file",
 *   skill: GeneratedSkillEntry
 * }} ShellMenuAction
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   detail?: string,
 *   action: ShellMenuAction
 * }} ShellMenuItem
 */

/**
 * @typedef {{
 *   open: boolean,
 *   section: ShellMenuSection,
 *   selectedIndex: number,
 *   generatedSkills: GeneratedSkillEntry[],
 *   focusedSkillName: string,
 *   lastUpdatedAt: string,
 *   notice: string
 * }} ShellMenuState
 */

/**
 * @typedef {{
 *   kind: "noop"
 * } | {
 *   kind: "help"
 * } | {
 *   kind: "status"
 * } | {
 *   kind: "clear"
 * } | {
 *   kind: "exit"
 * } | {
 *   kind: "error",
 *   message: string
 * } | {
 *   kind: "info",
 *   message: string
 * } | {
 *   kind: "exec",
 *   argv: string[],
 *   label: string
 * } | {
 *   kind: "menu",
 *   section?: ShellMenuSection,
 *   open?: boolean,
 *   toggle?: boolean
 * }} ShellInputAction
 */

/**
 * @typedef {{
 *   options: Record<string, string>,
 *   runCli: (argv: string[]) => Promise<{ exitCode: number, stdout?: string, stderr?: string }>,
 *   usageText?: () => string,
 *   stdin?: NodeJS.ReadStream,
 *   stdout?: NodeJS.WriteStream,
 *   stderr?: NodeJS.WriteStream,
 *   cwd?: string
 * }} RunShellInput
 */

/** @type {ShellTab[]} */
export const SHELL_TABS = [
  { id: "recall", label: "Recall", command: "recall" },
  { id: "teach", label: "Teach", command: "teach" },
  { id: "remember", label: "Remember", command: "remember" },
  { id: "doctor", label: "Doctor", command: "doctor" },
  { id: "select", label: "Select", command: "select" }
];

/**
 * @type {Record<ShellTabId, { chip: string, prompt: string, icon: string }>}
 */
const TAB_THEME = {
  recall: { chip: "1;38;5;51;48;5;235", prompt: "96", icon: "R" },
  teach: { chip: "1;38;5;201;48;5;235", prompt: "95", icon: "T" },
  remember: { chip: "1;38;5;220;48;5;235", prompt: "93", icon: "M" },
  doctor: { chip: "1;38;5;120;48;5;235", prompt: "92", icon: "D" },
  select: { chip: "1;38;5;87;48;5;235", prompt: "94", icon: "S" }
};

const TAB_HINTS = {
  recall: "type a query and press Enter to search memory",
  teach: "type a task and press Enter to generate teaching packet",
  remember: "type a durable note and press Enter to save memory",
  doctor: "press Enter to run diagnostics",
  select: "type focus keywords and press Enter to rank context"
};

/** @type {Record<string, ShellTabId>} */
const TAB_SHORTCUTS = {
  R: "recall",
  T: "teach",
  M: "remember",
  D: "doctor",
  S: "select",
  "1": "recall",
  "2": "teach",
  "3": "remember",
  "4": "doctor",
  "5": "select"
};

/**
 * @param {NodeJS.WriteStream} stream
 * @returns {boolean}
 */
function supportsAnsi(stream) {
  return Boolean(stream.isTTY) && process.env.NO_COLOR !== "1";
}

/**
 * @param {string} text
 * @param {string} code
 * @param {boolean} enabled
 * @returns {string}
 */
function ansi(text, code, enabled) {
  return enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripAnsi(text) {
  return String(text ?? "").replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * @param {string} text
 * @returns {number}
 */
function visibleLength(text) {
  return stripAnsi(text).length;
}

/**
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
function rightPad(text, width) {
  const size = visibleLength(text);

  if (size >= width) {
    return text;
  }

  return `${text}${" ".repeat(width - size)}`;
}

/**
 * @param {string} left
 * @param {string} right
 * @param {number} width
 * @returns {string}
 */
function justify(left, right, width) {
  const remaining = width - visibleLength(left) - visibleLength(right);
  return `${left}${" ".repeat(Math.max(1, remaining))}${right}`;
}

/**
 * @param {string[]} lines
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
function renderFramedBox(lines, options = {}) {
  const color = options.color ?? true;
  const width = Math.max(...lines.map((line) => visibleLength(line)));
  const border = "38;5;99";
  const top = ansi(`┌${"─".repeat(width + 2)}┐`, border, color);
  const bottom = ansi(`└${"─".repeat(width + 2)}┘`, border, color);
  const body = lines.map((line) => `${ansi("│", border, color)} ${rightPad(line, width)} ${ansi("│", border, color)}`);

  return [top, ...body, bottom].join("\n");
}

/**
 * @param {string | undefined} value
 * @returns {MemoryBackendMode}
 */
function normalizeMemoryBackend(value) {
  if (value === "engram-only" || value === "local-only") {
    return value;
  }

  return "resilient";
}

/**
 * @param {string | undefined} value
 * @returns {OutputFormat}
 */
function normalizeFormat(value) {
  return value === "json" ? "json" : "text";
}

/**
 * @param {string | undefined} value
 * @returns {ShellRenderMode}
 */
export function normalizeShellRenderMode(value) {
  return compact(String(value ?? "")).toLowerCase() === "safe" ? "safe" : "auto";
}

/**
 * @param {string | undefined} value
 * @returns {ShellTabId}
 */
function normalizeTab(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return SHELL_TABS.some((tab) => tab.id === normalized)
    ? /** @type {ShellTabId} */ (normalized)
    : "recall";
}

/**
 * @param {string} value
 * @returns {string}
 */
function compact(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ");
}

/**
 * Remove escape/control fragments that can appear in interactive readline input
 * when arrow keys are used heavily.
 * @param {string} value
 * @returns {string}
 */
function normalizeInteractiveLine(value) {
  return String(value ?? "")
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, "")
    .replace(/^\[[0-9;]*[A-Za-z]$/gu, "")
    .replace(/[\u0000-\u001F\u007F]/gu, "")
    .trim();
}

/**
 * @param {{ menuOpen: boolean, line: string }} input
 * @returns {boolean}
 */
export function shouldIgnoreMenuReadlineLine(input) {
  return Boolean(input.menuOpen && !normalizeInteractiveLine(input.line));
}

/**
 * @param {ShellMenuAction["type"]} actionType
 * @returns {boolean}
 */
export function shouldPreserveMenuActionOutput(actionType) {
  return (
    actionType === "run-cli" ||
    actionType === "run-script" ||
    actionType === "show-help" ||
    actionType === "show-skill" ||
    actionType === "show-skill-file"
  );
}

/**
 * @param {string | undefined} keyName
 * @returns {boolean}
 */
function isMenuActionKey(keyName) {
  return keyName === "return" ||
    keyName === "enter" ||
    keyName === "up" ||
    keyName === "down" ||
    keyName === "j" ||
    keyName === "k" ||
    keyName === "m" ||
    keyName === "n" ||
    keyName === "s";
}

/**
 * @param {{ commandInFlight: boolean, canCaptureMenuNav: boolean, keyName?: string }} input
 * @returns {boolean}
 */
export function shouldBlockMenuInteractionWhileBusy(input) {
  return Boolean(input.commandInFlight && input.canCaptureMenuNav && isMenuActionKey(input.keyName));
}

/**
 * @param {{ renderMode: ShellRenderMode, reason: ShellRenderReason, stateChanged: boolean }} input
 * @returns {{ redraw: boolean, clear: boolean }}
 */
export function evaluateDashboardRenderPolicy(input) {
  const redraw = input.reason === "manual-clear"
    ? true
    : input.reason === "navigation" || input.reason === "layout" || input.reason === "initial"
      ? true
      : input.stateChanged;

  if (!redraw) {
    return { redraw: false, clear: false };
  }

  if (input.renderMode === "safe") {
    const clear = input.reason === "manual-clear" ||
      input.reason === "navigation" ||
      input.reason === "layout" ||
      input.reason === "initial";
    return { redraw: true, clear };
  }

  return { redraw: true, clear: true };
}

/**
 * @param {string} filePath
 * @returns {Promise<unknown | null>}
 */
async function readJsonIfPresent(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/u, ""));
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error).code;
    if (code === "ENOENT") {
      return null;
    }
    return null;
  }
}

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} markdown
 * @param {string} key
 * @returns {string}
 */
function parseFrontmatterField(markdown, key) {
  const lines = String(markdown ?? "").split(/\r?\n/gu);

  if (lines[0]?.trim() !== "---") {
    return "";
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex === -1) {
    return "";
  }

  const target = `${key.toLowerCase()}:`;
  for (const line of lines.slice(1, endIndex)) {
    const compacted = compact(line);
    if (compacted.toLowerCase().startsWith(target)) {
      return compact(compacted.slice(target.length).replace(/^['"]|['"]$/gu, ""));
    }
  }

  return "";
}

/**
 * @param {string} cwd
 * @returns {Promise<GeneratedSkillEntry[]>}
 */
async function loadRepoSkillEntries(cwd) {
  const skillsRoot = path.resolve(cwd, "skills");
  /** @type {import("node:fs").Dirent[]} */
  let entries = [];
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  /** @type {GeneratedSkillEntry[]} */
  const output = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillFilePath = path.join(skillsRoot, entry.name, "SKILL.md");
    let raw = "";
    try {
      raw = await readFile(skillFilePath, "utf8");
    } catch {
      continue;
    }

    const name = parseFrontmatterField(raw, "name") || entry.name;
    const status = parseFrontmatterField(raw, "status") || (entry.name.startsWith("auto-") ? "draft" : "manual");

    output.push({
      name,
      status,
      occurrences: 0,
      updatedAt: "",
      filePath: path.relative(cwd, skillFilePath).replaceAll("\\", "/")
    });
  }

  return output;
}

/**
 * @param {string} cwd
 * @returns {Promise<GeneratedSkillEntry[]>}
 */
async function loadGeneratedSkillEntries(cwd) {
  const registryPath = path.resolve(cwd, "skills", "generated", "registry.json");
  const parsed = await readJsonIfPresent(registryPath);
  const rawSkills =
    typeof parsed === "object" &&
    parsed !== null &&
    "skills" in parsed &&
    Array.isArray(/** @type {{ skills?: unknown[] }} */ (parsed).skills)
      ? /** @type {unknown[]} */ (/** @type {{ skills?: unknown[] }} */ (parsed).skills ?? [])
      : [];

  const generated = rawSkills
    .map((skill) => {
      if (!skill || typeof skill !== "object") {
        return null;
      }

      const item = /** @type {Record<string, unknown>} */ (skill);
      const name = compact(String(item.name ?? ""));
      const status = compact(String(item.status ?? "draft")) || "draft";
      const occurrences = Number(item.occurrences ?? 0);
      const updatedAt = compact(String(item.updatedAt ?? item.createdAt ?? ""));
      const filePath = compact(String(item.filePath ?? ""));

      if (!name) {
        return null;
      }

      return {
        name,
        status,
        occurrences: Number.isFinite(occurrences) ? Math.max(0, Math.floor(occurrences)) : 0,
        updatedAt,
        filePath
      };
    })
    .filter((entry) => entry !== null);
  const repoSkills = await loadRepoSkillEntries(cwd);
  /** @type {Map<string, GeneratedSkillEntry>} */
  const byName = new Map();

  for (const entry of [...repoSkills, ...generated]) {
    if (!entry) {
      continue;
    }

    const key = entry.name.toLowerCase();
    const current = byName.get(key);

    if (!current) {
      byName.set(key, entry);
      continue;
    }

    byName.set(key, {
      name: current.name || entry.name,
      status: current.status === "manual" && entry.status ? entry.status : current.status || entry.status,
      occurrences: Math.max(current.occurrences, entry.occurrences),
      updatedAt: current.updatedAt || entry.updatedAt,
      filePath: current.filePath || entry.filePath
    });
  }

  return [...byName.values()].sort((left, right) => {
    if ((right.occurrences ?? 0) !== (left.occurrences ?? 0)) {
      return (right.occurrences ?? 0) - (left.occurrences ?? 0);
    }

    return left.name.localeCompare(right.name);
  });
}

/**
 * @returns {ShellMenuState}
 */
function createShellMenuState() {
  return {
    open: true,
    section: "nexus",
    selectedIndex: 0,
    generatedSkills: [],
    focusedSkillName: "",
    lastUpdatedAt: "",
    notice: ""
  };
}

/**
 * @param {ShellState} state
 * @returns {ShellMenuItem[]}
 */
function buildNexusMenuItems(state) {
  return [
    {
      id: "tab-recall",
      label: "Ir a tab Recall",
      detail: "Buscar memoria durable por query",
      action: { type: "open-section", section: "nexus-recall" }
    },
    {
      id: "tab-teach",
      label: "Ir a tab Teach",
      detail: "Construir packet pedagogico con contexto",
      action: { type: "open-section", section: "nexus-teach" }
    },
    {
      id: "tab-remember",
      label: "Ir a tab Remember",
      detail: "Guardar decision durable en memoria",
      action: { type: "open-section", section: "nexus-remember" }
    },
    {
      id: "tab-select",
      label: "Ir a tab Select",
      detail: "Rankear chunks de contexto por foco",
      action: { type: "open-section", section: "nexus-select" }
    },
    {
      id: "run-doctor",
      label: "Ejecutar Doctor ahora",
      detail: "Diagnostico completo del entorno",
      action: { type: "open-section", section: "nexus-doctor" }
    },
    {
      id: "run-version",
      label: "Ver version NEXUS",
      detail: "Estado de version del CLI",
      action: { type: "open-section", section: "nexus-version" }
    },
    {
      id: "show-help",
      label: "Mostrar todas las opciones NEXUS",
      detail: "Comandos CLI + atajos de shell",
      action: { type: "open-section", section: "nexus-help" }
    },
    {
      id: "open-skills",
      label: "Abrir Skills Manager →",
      detail: "Administrar skills creadas y calidad",
      action: { type: "open-section", section: "skills" }
    }
  ];
}

/**
 * @param {ShellState} state
 * @returns {ShellMenuItem[]}
 */
function buildNexusRecallMenuItems(state) {
  return [
    {
      id: "recall-back",
      label: "← Volver a NEXUS",
      detail: "Menu principal",
      action: { type: "open-section", section: "nexus" }
    },
    {
      id: "recall-tab",
      label: "Activar tab Recall",
      detail: "Volver al flujo interactivo recall",
      action: { type: "switch-tab", tab: "recall" }
    },
    {
      id: "recall-example-text",
      label: "Ejecutar recall ejemplo (text)",
      detail: "Query: nexus shell skills manager",
      action: {
        type: "run-cli",
        argv: applySessionDefaults(["recall", "--query", "nexus shell skills manager"], state),
        rawLine: "/recall nexus shell skills manager"
      }
    },
    {
      id: "recall-example-json",
      label: "Ejecutar recall ejemplo (json)",
      detail: "Respuesta estructurada para debug",
      action: {
        type: "run-cli",
        argv: applySessionDefaults(["recall", "--query", "nexus shell skills manager", "--format", "json"], state),
        rawLine: "/recall nexus shell skills manager --format json"
      }
    }
  ];
}

/**
 * @param {ShellState} state
 * @returns {ShellMenuItem[]}
 */
function buildNexusTeachMenuItems(state) {
  return [
    {
      id: "teach-back",
      label: "← Volver a NEXUS",
      detail: "Menu principal",
      action: { type: "open-section", section: "nexus" }
    },
    {
      id: "teach-tab",
      label: "Activar tab Teach",
      detail: "Volver al flujo interactivo teach",
      action: { type: "switch-tab", tab: "teach" }
    },
    {
      id: "teach-example-text",
      label: "Ejecutar teach ejemplo (text)",
      detail: "Task: explain shell skills workflow",
      action: {
        type: "run-cli",
        argv: applySessionDefaults(
          ["teach", "--task", "Explain shell skills workflow", "--objective", "Teach menu-driven skill operations"],
          state
        ),
        rawLine: "/teach Explain shell skills workflow"
      }
    },
    {
      id: "teach-example-json",
      label: "Ejecutar teach ejemplo (json)",
      detail: "Formato JSON para inspeccion",
      action: {
        type: "run-cli",
        argv: applySessionDefaults(
          [
            "teach",
            "--task",
            "Explain shell skills workflow",
            "--objective",
            "Teach menu-driven skill operations",
            "--format",
            "json"
          ],
          state
        ),
        rawLine: "/teach Explain shell skills workflow --format json"
      }
    }
  ];
}

/**
 * @param {ShellState} state
 * @returns {ShellMenuItem[]}
 */
function buildNexusRememberMenuItems(state) {
  return [
    {
      id: "remember-back",
      label: "← Volver a NEXUS",
      detail: "Menu principal",
      action: { type: "open-section", section: "nexus" }
    },
    {
      id: "remember-tab",
      label: "Activar tab Remember",
      detail: "Volver al flujo interactivo remember",
      action: { type: "switch-tab", tab: "remember" }
    },
    {
      id: "remember-example",
      label: "Guardar memoria ejemplo",
      detail: "Nota durable del shell manager",
      action: {
        type: "run-cli",
        argv: applySessionDefaults(
          [
            "remember",
            "--title",
            "Shell skills manager",
            "--content",
            "Submenus by area improve operational navigation in NEXUS shell."
          ],
          state
        ),
        rawLine: "/remember shell submenu note"
      }
    }
  ];
}

/**
 * @param {ShellState} state
 * @returns {ShellMenuItem[]}
 */
function buildNexusSelectMenuItems(state) {
  return [
    {
      id: "select-back",
      label: "← Volver a NEXUS",
      detail: "Menu principal",
      action: { type: "open-section", section: "nexus" }
    },
    {
      id: "select-tab",
      label: "Activar tab Select",
      detail: "Volver al flujo interactivo select",
      action: { type: "switch-tab", tab: "select" }
    },
    {
      id: "select-example-text",
      label: "Ejecutar select ejemplo",
      detail: "Focus: shell menu skills manager",
      action: {
        type: "run-cli",
        argv: applySessionDefaults(["select", "--focus", "shell menu skills manager"], state),
        rawLine: "/select shell menu skills manager"
      }
    },
    {
      id: "select-example-debug",
      label: "Ejecutar select ejemplo (debug)",
      detail: "Incluye diagnostico de seleccion",
      action: {
        type: "run-cli",
        argv: applySessionDefaults(["select", "--focus", "shell menu skills manager", "--debug"], state),
        rawLine: "/select shell menu skills manager --debug"
      }
    }
  ];
}

/**
 * @param {ShellState} state
 * @returns {ShellMenuItem[]}
 */
function buildNexusDoctorMenuItems(state) {
  return [
    {
      id: "doctor-back",
      label: "← Volver a NEXUS",
      detail: "Menu principal",
      action: { type: "open-section", section: "nexus" }
    },
    {
      id: "doctor-tab",
      label: "Activar tab Doctor",
      detail: "Volver al flujo interactivo doctor",
      action: { type: "switch-tab", tab: "doctor" }
    },
    {
      id: "doctor-run-text",
      label: "Ejecutar doctor (text)",
      detail: "Diagnostico legible",
      action: { type: "run-cli", argv: applySessionDefaults(["doctor"], state), rawLine: "/doctor" }
    },
    {
      id: "doctor-run-json",
      label: "Ejecutar doctor (json)",
      detail: "Diagnostico estructurado",
      action: { type: "run-cli", argv: applySessionDefaults(["doctor", "--format", "json"], state), rawLine: "/doctor --format json" }
    }
  ];
}

/**
 * @returns {ShellMenuItem[]}
 */
function buildNexusVersionMenuItems() {
  return [
    {
      id: "version-back",
      label: "← Volver a NEXUS",
      detail: "Menu principal",
      action: { type: "open-section", section: "nexus" }
    },
    {
      id: "version-run-text",
      label: "Mostrar version (text)",
      detail: "Salida simple",
      action: { type: "run-cli", argv: ["version"], rawLine: "/version" }
    },
    {
      id: "version-run-json",
      label: "Mostrar version (json)",
      detail: "Salida estructurada",
      action: { type: "run-cli", argv: ["version", "--format", "json"], rawLine: "/version --format json" }
    }
  ];
}

/**
 * @returns {ShellMenuItem[]}
 */
function buildNexusHelpMenuItems() {
  return [
    {
      id: "help-back",
      label: "← Volver a NEXUS",
      detail: "Menu principal",
      action: { type: "open-section", section: "nexus" }
    },
    {
      id: "help-shell",
      label: "Mostrar ayuda de shell",
      detail: "Atajos y comandos interactivos",
      action: { type: "show-help" }
    }
  ];
}

/**
 * @param {ShellMenuState} menu
 * @returns {ShellMenuItem[]}
 */
function buildSkillsMenuItems(menu) {
  /** @type {ShellMenuItem[]} */
  const items = [
    {
      id: "back-nexus",
      label: "← Volver a menu NEXUS",
      detail: "Seccion general del workspace",
      action: { type: "open-section", section: "nexus" }
    },
    {
      id: "refresh-skills",
      label: "Refrescar lista de skills",
      detail: "Recarga registry y estado actual",
      action: { type: "refresh-skills" }
    },
    {
      id: "skills-doctor",
      label: "Correr skills doctor",
      detail: "Auditar duplicados/similares (texto)",
      action: {
        type: "run-script",
        command: process.execPath,
        args: ["scripts/doctor-skills.js", "--skills-dir", "skills"],
        rawLine: "skills:doctor"
      }
    },
    {
      id: "skills-doctor-strict",
      label: "Correr skills doctor strict",
      detail: "Falla si hay conflictos (scope repo, deterministico)",
      action: {
        type: "run-script",
        command: process.execPath,
        args: [
          "scripts/doctor-skills.js",
          "--no-system-scan",
          "--skills-dir",
          "skills",
          "--fail-on-conflicts"
        ],
        rawLine: "skills:doctor:strict"
      }
    },
    {
      id: "skills-doctor-strict-full",
      label: "Correr skills doctor strict full",
      detail: "Falla si hay conflictos (repo + system, incluye mirrors)",
      action: {
        type: "run-script",
        command: process.execPath,
        args: [
          "scripts/doctor-skills.js",
          "--skills-dir",
          "skills",
          "--include-mirror-duplicates",
          "--fail-on-conflicts"
        ],
        rawLine: "skills:doctor:strict:full"
      }
    },
    {
      id: "skills-auto-dry",
      label: "Probar auto-generator (dry-run)",
      detail: "Detectar repeticion sin escribir archivos",
      action: {
        type: "run-script",
        command: process.execPath,
        args: [
          "scripts/auto-generate-skills.js",
          "--dry-run",
          "--history",
          ".lcs/shell-history",
          "--telemetry",
          ".lcs/shell-telemetry.jsonl",
          "--output-dir",
          "skills/generated",
          "--min-repetitions",
          "3",
          "--top",
          "5"
        ],
        rawLine: "skills:auto:dry"
      }
    },
    {
      id: "skills-promote-dry",
      label: "Probar promocion (dry-run)",
      detail: "Evaluar draft -> experimental sin escribir",
      action: {
        type: "run-script",
        command: process.execPath,
        args: [
          "scripts/promote-generated-skills.js",
          "--dry-run",
          "--registry",
          "skills/generated/registry.json",
          "--telemetry",
          ".lcs/shell-telemetry.jsonl"
        ],
        rawLine: "skills:promote:dry"
      }
    }
  ];

  if (menu.generatedSkills.length === 0) {
    items.push({
      id: "no-skills",
      label: "No hay skills generadas",
      detail: "Ejecuta auto-generator para crear drafts",
      action: { type: "show-help" }
    });
    return items;
  }

  for (const skill of menu.generatedSkills.slice(0, 12)) {
    const occ = skill.occurrences > 0 ? ` • ${skill.occurrences}x` : "";
    items.push({
      id: `skill-${skill.name}`,
      label: `${skill.name} [${skill.status}]${occ}`,
      detail: skill.filePath || "registry entry",
      action: { type: "open-skill-actions", skill }
    });
  }

  if (menu.generatedSkills.length > 12) {
    items.push({
      id: "skills-truncated",
      label: `+${menu.generatedSkills.length - 12} skills mas (ver registry.json)`,
      detail: "skills/generated/registry.json",
      action: { type: "show-help" }
    });
  }

  return items;
}

/**
 * @param {ShellMenuState} menu
 * @returns {GeneratedSkillEntry | null}
 */
function getFocusedSkill(menu) {
  const target = compact(menu.focusedSkillName).toLowerCase();
  if (!target) {
    return null;
  }

  return menu.generatedSkills.find((skill) => skill.name.toLowerCase() === target) ?? null;
}

/**
 * @param {ShellMenuState} menu
 * @returns {ShellMenuItem[]}
 */
function buildSkillActionMenuItems(menu) {
  const skill = getFocusedSkill(menu);

  if (!skill) {
    return [
      {
        id: "back-skills-missing",
        label: "← Volver a Skills Manager",
        detail: "Skill no encontrada. Refresca la lista.",
        action: { type: "open-section", section: "skills" }
      },
      {
        id: "refresh-missing-skill",
        label: "Refrescar lista de skills",
        detail: "Intentar recuperar la skill objetivo",
        action: { type: "refresh-skills" }
      }
    ];
  }

  return [
    {
      id: "skill-actions-back",
      label: "← Volver a Skills Manager",
      detail: "Lista completa de skills",
      action: { type: "open-section", section: "skills" }
    },
    {
      id: "skill-actions-preview",
      label: "Ver preview rapido",
      detail: "Resumen + primeras lineas",
      action: { type: "show-skill", skill }
    },
    {
      id: "skill-actions-open-file",
      label: "Abrir archivo completo",
      detail: "Mostrar contenido completo de SKILL.md",
      action: { type: "show-skill-file", skill }
    },
    {
      id: "skill-actions-promote-exp",
      label: "Promover manual a experimental",
      detail: "Actualiza status en registry",
      action: { type: "promote-skill", skillName: skill.name, status: "experimental" }
    },
    {
      id: "skill-actions-promote-stable",
      label: "Promover manual a stable",
      detail: "Marca skill como estable",
      action: { type: "promote-skill", skillName: skill.name, status: "stable" }
    },
    {
      id: "skill-actions-archive",
      label: "Archivar skill",
      detail: "Mueve carpeta a skills/archive y limpia registry",
      action: { type: "archive-skill", skillName: skill.name }
    },
    {
      id: "skill-actions-refresh",
      label: "Refrescar estado",
      detail: "Relee registry y skills del repo",
      action: { type: "refresh-skills" }
    }
  ];
}

/**
 * @param {ShellMenuState} menu
 * @param {ShellState} state
 * @returns {ShellMenuItem[]}
 */
function getShellMenuItems(menu, state) {
  switch (menu.section) {
    case "skills":
      return buildSkillsMenuItems(menu);
    case "skill-actions":
      return buildSkillActionMenuItems(menu);
    case "nexus-recall":
      return buildNexusRecallMenuItems(state);
    case "nexus-teach":
      return buildNexusTeachMenuItems(state);
    case "nexus-remember":
      return buildNexusRememberMenuItems(state);
    case "nexus-select":
      return buildNexusSelectMenuItems(state);
    case "nexus-doctor":
      return buildNexusDoctorMenuItems(state);
    case "nexus-version":
      return buildNexusVersionMenuItems();
    case "nexus-help":
      return buildNexusHelpMenuItems();
    case "nexus":
    default:
      return buildNexusMenuItems(state);
  }
}

/**
 * @param {ShellMenuState} menu
 * @param {ShellState} state
 * @returns {ShellMenuItem | null}
 */
function getSelectedShellMenuItem(menu, state) {
  const items = getShellMenuItems(menu, state);

  if (items.length === 0) {
    return null;
  }

  const normalizedIndex = Math.max(0, Math.min(items.length - 1, menu.selectedIndex));
  menu.selectedIndex = normalizedIndex;
  return items[normalizedIndex] ?? null;
}

/**
 * @param {ShellMenuSection} section
 * @returns {boolean}
 */
function isNexusSection(section) {
  return section === "nexus" || section.startsWith("nexus-");
}

/**
 * @param {ShellMenuSection} section
 * @returns {string}
 */
function formatMenuSectionLabel(section) {
  switch (section) {
    case "nexus":
      return "NEXUS";
    case "nexus-recall":
      return "NEXUS • RECALL";
    case "nexus-teach":
      return "NEXUS • TEACH";
    case "nexus-remember":
      return "NEXUS • REMEMBER";
    case "nexus-select":
      return "NEXUS • SELECT";
    case "nexus-doctor":
      return "NEXUS • DOCTOR";
    case "nexus-version":
      return "NEXUS • VERSION";
    case "nexus-help":
      return "NEXUS • HELP";
    case "skills":
      return "SKILLS";
    case "skill-actions":
      return "SKILL ACTIONS";
    default:
      return "UNKNOWN";
  }
}

/**
 * @param {ShellMenuState} menu
 * @param {ShellState} state
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
function renderShellMenu(menu, state, options = {}) {
  const color = options.color ?? true;
  const items = getShellMenuItems(menu, state);
  const focusedSkill = getFocusedSkill(menu);
  const header = justify(
    `${ansi("NEXUS MENU", "1;38;5;111", color)} ${ansi(`(${formatMenuSectionLabel(menu.section)})`, "1;38;5;183", color)}`,
    `${ansi("↑/↓ move • Enter run • M hide", "38;5;246", color)}`,
    60
  );
  const summary =
    menu.section === "skills"
      ? `skills: ${menu.generatedSkills.length} • updated: ${menu.lastUpdatedAt || "n/a"}`
      : menu.section === "skill-actions"
        ? `skill: ${focusedSkill?.name ?? "(no seleccionada)"} • status: ${focusedSkill?.status ?? "n/a"}`
        : menu.section === "nexus-recall"
          ? "submenu recall: tab + examples + salida json"
          : menu.section === "nexus-teach"
            ? "submenu teach: task/objective y ejemplos"
            : menu.section === "nexus-remember"
              ? "submenu remember: guardar decisiones durables"
              : menu.section === "nexus-select"
                ? "submenu select: ranking de contexto y debug"
                : menu.section === "nexus-doctor"
                  ? "submenu doctor: health checks text/json"
                  : menu.section === "nexus-version"
                    ? "submenu version: info text/json"
                    : menu.section === "nexus-help"
                      ? "submenu help: comandos y atajos shell"
        : `active tab: ${state.activeTab} • project: ${state.session.project || "(none)"}`;
  const baseLines = [
    header,
    ansi(summary, "38;5;248", color),
    ansi(
      menu.section === "skill-actions"
        ? "N = NEXUS • S = Skills list • Enter ejecutar accion"
        : isNexusSection(menu.section) && menu.section !== "nexus"
          ? "N = NEXUS root • S = Skills manager • ← Back option"
        : "N = NEXUS options • S = Skills manager",
      "38;5;245",
      color
    ),
    ""
  ];

  if (menu.section === "nexus") {
    baseLines.splice(
      3,
      0,
      ansi(
        "commands: version init doctor sync-knowledge ingest-security select teach readme recall remember close shell",
        "38;5;244",
        color
      )
    );
  }

  const rows = items.slice(0, 14).map((item, index) => {
    const selected = index === menu.selectedIndex;
    const pointer = selected ? ansi("▸", "1;38;5;87", color) : ansi(" ", "38;5;240", color);
    const label = selected ? ansi(item.label, "1;38;5;51", color) : ansi(item.label, "38;5;252", color);
    const detail = item.detail ? ansi(` — ${item.detail}`, "38;5;245", color) : "";

    return `${pointer} ${label}${detail}`;
  });

  if (menu.notice) {
    rows.push("");
    rows.push(`${ansi("info", "1;38;5;120", color)} ${ansi(menu.notice, "38;5;249", color)}`);
  }

  return renderFramedBox([...baseLines, ...rows], { color });
}

/**
 * @param {string[]} argv
 * @param {string} key
 * @returns {boolean}
 */
function hasOption(argv, key) {
  const flag = `--${key}`;

  return argv.some((entry) => entry === flag || entry.startsWith(`${flag}=`));
}

/**
 * @param {string[]} argv
 * @param {string} key
 * @param {string} value
 * @returns {string[]}
 */
function withOption(argv, key, value) {
  if (!value || hasOption(argv, key)) {
    return argv;
  }

  return [...argv, `--${key}`, value];
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
export function tokenizeShellInput(raw) {
  const input = String(raw ?? "").trim();

  if (!input) {
    return [];
  }

  /** @type {string[]} */
  const out = [];
  let current = "";
  /** @type {null | "'" | '"'} */
  let quote = null;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/u.test(char)) {
      if (current) {
        out.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    out.push(current);
  }

  return out;
}

/**
 * @param {Partial<ShellState & { session: Partial<ShellSessionConfig> }> & { cwd?: string }} [input]
 * @returns {ShellState}
 */
export function createShellState(input = {}) {
  const cwd = input.cwd ?? process.cwd();
  const activeTab = normalizeTab(input.activeTab);
  const historyFilePath =
    input.historyFilePath ??
    path.resolve(cwd, ".lcs", "shell-history");
  const telemetryFilePath =
    input.telemetryFilePath ??
    path.resolve(cwd, ".lcs", "shell-telemetry.jsonl");
  const commandCount =
    typeof input.commandCount === "number" && Number.isFinite(input.commandCount)
      ? input.commandCount
      : 0;
  const startedAt =
    typeof input.startedAt === "number" && Number.isFinite(input.startedAt)
      ? input.startedAt
      : Date.now();

  return {
    activeTab,
    selectorIndex:
      typeof input.selectorIndex === "number" && Number.isFinite(input.selectorIndex)
        ? Math.max(0, Math.min(SHELL_TABS.length - 1, Math.floor(input.selectorIndex)))
        : Math.max(0, SHELL_TABS.findIndex((entry) => entry.id === activeTab)),
    session: {
      project: input.session?.project ?? "",
      workspace: input.session?.workspace ?? ".",
      memoryBackend: normalizeMemoryBackend(input.session?.memoryBackend),
      format: normalizeFormat(input.session?.format)
    },
    historyFilePath,
    telemetryFilePath,
    commandCount,
    startedAt
  };
}

/**
 * @param {ShellTabId} current
 * @returns {ShellTabId}
 */
function nextTab(current) {
  const currentIndex = SHELL_TABS.findIndex((tab) => tab.id === current);
  const nextIndex = (currentIndex + 1) % SHELL_TABS.length;
  return SHELL_TABS[nextIndex]?.id ?? "recall";
}

/**
 * @param {ShellTabId} tabId
 * @returns {number}
 */
function tabIndex(tabId) {
  return Math.max(0, SHELL_TABS.findIndex((tab) => tab.id === tabId));
}

/**
 * @param {ShellTabId} current
 * @returns {ShellTabId}
 */
function previousTab(current) {
  const currentIndex = SHELL_TABS.findIndex((tab) => tab.id === current);
  const prevIndex = (currentIndex - 1 + SHELL_TABS.length) % SHELL_TABS.length;
  return SHELL_TABS[prevIndex]?.id ?? "recall";
}

/**
 * @param {ShellState} state
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
export function renderShellTabs(state, options = {}) {
  const color = options.color ?? true;

  return SHELL_TABS
    .map((tab) => {
      const theme = TAB_THEME[tab.id];
      const label = `${theme.icon} ${tab.label}`;

      if (tab.id === state.activeTab) {
        return ansi(` ${label} `, theme.chip, color);
      }

      return ansi(` ${label} `, "38;5;245", color);
    })
    .join(" ");
}

/**
 * @param {ShellState} state
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
function renderShellSessionLine(state, options = {}) {
  const color = options.color ?? true;
  const project = state.session.project || "(none)";
  const workspace = state.session.workspace || ".";
  const backend = state.session.memoryBackend;
  const format = state.session.format;

  return [
    `${ansi("project", "1;38;5;147", color)}=${project}`,
    `${ansi("workspace", "1;38;5;147", color)}=${workspace}`,
    `${ansi("backend", "1;38;5;147", color)}=${backend}`,
    `${ansi("format", "1;38;5;147", color)}=${format}`
  ].join("  ");
}

/**
 * @param {ShellState} state
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
function renderShellBanner(state, options = {}) {
  const color = options.color ?? true;
  const memoryMode =
    state.session.memoryBackend === "engram-only"
      ? "ENGRAM"
      : state.session.memoryBackend === "local-only"
        ? "LOCAL"
        : "RESILIENT";
  const health = `${ansi("●", "1;38;5;118", color)} ${ansi("ONLINE", "1;38;5;118", color)}`;
  const header = justify(
    `${ansi("NEXUS", "1;38;5;51", color)} ${ansi("DARK NEON CONSOLE", "1;38;5;201", color)}`,
    `${health} ${ansi(`MEM:${memoryMode}`, "1;38;5;183", color)}`,
    60
  );
  const subtitle = ansi("learning workspace • interactive tabs • memory-first CLI", "38;5;111", color);
  const footer = [
    `${ansi("controls", "1;38;5;87", color)} ${ansi("TAB/←/→ switch tabs", "38;5;252", color)} ${ansi("•", "38;5;240", color)} ${ansi("Ctrl+L clear", "38;5;252", color)} ${ansi("•", "38;5;240", color)} ${ansi("/status", "38;5;252", color)}`,
    `${ansi("tip", "1;38;5;87", color)} ${ansi("/help command list", "38;5;252", color)} ${ansi("•", "38;5;240", color)} ${ansi("/exit close session", "38;5;252", color)}`
  ];

  return [
    "",
    renderFramedBox([header, subtitle, "", ...footer], { color }),
    renderShellSessionLine(state, { color }),
    renderShellTabs(state, { color })
  ].join("\n");
}

/**
 * @param {ShellState} state
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
function renderActiveTabHint(state, options = {}) {
  const color = options.color ?? true;
  const tab = state.activeTab;
  const theme = TAB_THEME[tab];
  const label = SHELL_TABS.find((entry) => entry.id === tab)?.label ?? tab;
  const hint = TAB_HINTS[tab] ?? "";

  return `${ansi("mode", "1;38;5;99", color)} ${ansi(label, `1;${theme.prompt}`, color)} ${ansi("•", "38;5;240", color)} ${ansi(hint, "38;5;252", color)}`;
}

/**
 * @param {number} durationMs
 * @returns {string}
 */
function formatDuration(durationMs) {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remaining}s`;
  }

  return `${seconds}s`;
}

/**
 * @param {ShellState} state
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
function renderShellStatus(state, options = {}) {
  const color = options.color ?? true;
  const elapsed = formatDuration(Date.now() - state.startedAt);
  return [
    `${ansi("status", "1;38;5;87", color)} ${ansi("session", "38;5;252", color)}`,
    `${ansi("tab", "1;38;5;147", color)}=${state.activeTab} ${ansi("commands", "1;38;5;147", color)}=${state.commandCount} ${ansi("elapsed", "1;38;5;147", color)}=${elapsed}`
  ].join("\n");
}

/**
 * @param {ShellState} state
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
function renderPrompt(state, options = {}) {
  const color = options.color ?? true;
  const theme = TAB_THEME[state.activeTab];
  const name = ansi("nexus", "1;38;5;51", color);
  const tab = ansi(state.activeTab, `1;${theme.prompt}`, color);
  const arrow = ansi("❯", "38;5;240", color);
  return `${name}[${tab}]${arrow} `;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {ShellState} state
 * @returns {string[]}
 */
function buildCommandArgv(command, args, state) {
  const c = command.toLowerCase();
  const hasFlags = args.some((token) => token.startsWith("--"));
  /** @type {string[]} */
  let argv;

  if (c === "recall") {
    argv = hasFlags
      ? ["recall", ...args]
      : args.length
        ? ["recall", "--query", args.join(" ")]
        : ["recall"];
  } else if (c === "teach") {
    argv = hasFlags
      ? ["teach", ...args]
      : args.length
        ? ["teach", "--task", args.join(" "), "--objective", args.join(" ")]
        : ["teach"];
  } else if (c === "remember") {
    argv = hasFlags
      ? ["remember", ...args]
      : args.length
        ? ["remember", "--title", "Shell note", "--content", args.join(" ")]
        : ["remember"];
  } else if (c === "doctor") {
    argv = ["doctor", ...args];
  } else if (c === "select") {
    argv = hasFlags
      ? ["select", ...args]
      : args.length
        ? ["select", "--focus", args.join(" ")]
        : ["select"];
  } else {
    argv = [c, ...args];
  }

  return applySessionDefaults(argv, state);
}

/**
 * @param {string} rawLine
 * @param {ShellState} state
 * @returns {ShellInputAction}
 */
export function resolveShellInput(rawLine, state) {
  const line = String(rawLine ?? "").trim();

  if (!line) {
    return { kind: "noop" };
  }

  const quickTab = TAB_SHORTCUTS[/** @type {keyof typeof TAB_SHORTCUTS} */ (line.toUpperCase())] ?? TAB_SHORTCUTS[/** @type {keyof typeof TAB_SHORTCUTS} */ (line)];

  if (quickTab) {
    state.activeTab = quickTab;
    return { kind: "info", message: `Tab active: ${quickTab}` };
  }

  if (line.startsWith("/")) {
    const parts = tokenizeShellInput(line.slice(1));
    const command = String(parts[0] ?? "").toLowerCase();
    const args = parts.slice(1);

    if (!command) {
      return { kind: "noop" };
    }

    if (command === "help") {
      return { kind: "help" };
    }

    if (command === "status") {
      return { kind: "status" };
    }

    if (command === "menu") {
      const mode = String(args[0] ?? "").toLowerCase();

      if (!mode || mode === "toggle") {
        return { kind: "menu", toggle: true };
      }

      if (mode === "open" || mode === "show") {
        return { kind: "menu", open: true };
      }

      if (mode === "close" || mode === "hide") {
        return { kind: "menu", open: false };
      }

      if (mode === "skills") {
        return { kind: "menu", open: true, section: "skills" };
      }

      if (mode === "nexus") {
        return { kind: "menu", open: true, section: "nexus" };
      }

      return {
        kind: "error",
        message: "Use /menu [toggle|open|close|skills|nexus]."
      };
    }

    if (command === "skills") {
      return { kind: "menu", open: true, section: "skills" };
    }

    if (command === "nexus") {
      return { kind: "menu", open: true, section: "nexus" };
    }

    if (command === "clear" || command === "cls") {
      return { kind: "clear" };
    }

    if (command === "exit" || command === "quit" || command === "q") {
      return { kind: "exit" };
    }

    if (command === "tab") {
      const requested = normalizeTab(args[0]);

      if (!args[0]) {
        return { kind: "error", message: "Use /tab <recall|teach|remember|doctor|select>." };
      }

      state.activeTab = requested;
      return { kind: "info", message: `Tab active: ${requested}` };
    }

    if (command === "set") {
      const key = String(args[0] ?? "").toLowerCase();
      const value = args.slice(1).join(" ").trim();

      if (!key || !value) {
        return {
          kind: "error",
          message: "Use /set <project|workspace|backend|format> <value>."
        };
      }

      if (key === "project") {
        state.session.project = value;
        return { kind: "info", message: `Project set to '${value}'.` };
      }

      if (key === "workspace") {
        state.session.workspace = value;
        return { kind: "info", message: `Workspace set to '${value}'.` };
      }

      if (key === "backend") {
        const backend = normalizeMemoryBackend(value);
        state.session.memoryBackend = backend;
        return { kind: "info", message: `Memory backend set to '${backend}'.` };
      }

      if (key === "format") {
        const format = normalizeFormat(value);
        state.session.format = format;
        return { kind: "info", message: `Output format set to '${format}'.` };
      }

      return {
        kind: "error",
        message: "Unknown setting. Use project, workspace, backend or format."
      };
    }

    const argv = buildCommandArgv(command, args, state);
    return { kind: "exec", argv, label: `/${command}` };
  }

  return {
    kind: "exec",
    argv: buildTabCommandArgv(line, state),
    label: state.activeTab
  };
}

/**
 * @param {string[]} argv
 * @param {ShellState} state
 * @returns {string[]}
 */
function applySessionDefaults(argv, state) {
  const command = String(argv[0] ?? "");
  let out = [...argv];

  if (command === "recall" || command === "teach") {
    out = withOption(out, "memory-backend", state.session.memoryBackend);
  }

  if (
    command === "recall" ||
    command === "teach" ||
    command === "remember" ||
    command === "select" ||
    command === "doctor" ||
    command === "readme"
  ) {
    out = withOption(out, "format", state.session.format);
  }

  if (state.session.project) {
    out = withOption(out, "project", state.session.project);
  }

  if ((command === "teach" || command === "select" || command === "readme") && state.session.workspace) {
    out = withOption(out, "workspace", state.session.workspace);
  }

  return out;
}

/**
 * @param {string} line
 * @param {ShellState} state
 * @returns {string[]}
 */
function buildTabCommandArgv(line, state) {
  if (state.activeTab === "recall") {
    return applySessionDefaults(["recall", "--query", line], state);
  }

  if (state.activeTab === "teach") {
    return applySessionDefaults(
      ["teach", "--task", line, "--objective", line],
      state
    );
  }

  if (state.activeTab === "remember") {
    return applySessionDefaults(
      ["remember", "--title", "Shell note", "--content", line],
      state
    );
  }

  if (state.activeTab === "doctor") {
    return applySessionDefaults(["doctor"], state);
  }

  return applySessionDefaults(
    ["select", "--focus", line],
    state
  );
}

/**
 * @param {ShellState} state
 * @returns {string}
 */
export function renderShellHelp(state) {
  const tabNames = SHELL_TABS.map((tab) => tab.id).join(", ");

  return [
    "NEXUS shell commands:",
    "- /help               show this help",
    "- /exit | /quit | /q  close shell",
    `- /tab <${tabNames}>  switch active tab`,
    "- /set project <name>",
    "- /set workspace <dir>",
    "- /set backend <resilient|engram-only|local-only>",
    "- /set format <text|json>",
    "- /status             show live shell status",
    "- /menu [mode]        toggle/open/close skills menu",
    "- /skills             open skills manager section",
    "- /nexus              open nexus options section",
    "- /clear              clear terminal and redraw dashboard",
    "- /recall <query>     run recall quickly",
    "- /teach <text>       quick teach task/objective",
    "- /remember <text>    save durable note",
    "- /doctor             run doctor",
    "- /select <focus>     run selector",
    "- R/T/M/D/S or 1..5   quick switch tab",
    "- ↑/↓ + Enter         navigate/execute menu option",
    "",
    `Current tab: ${state.activeTab}`,
    "Tip: press TAB or ←/→ to rotate tabs. Ctrl+L clears the screen."
  ].join("\n");
}

/**
 * @param {NodeJS.WriteStream} target
 * @param {string} text
 */
function write(target, text) {
  target.write(text.endsWith("\n") ? text : `${text}\n`);
}

/**
 * @param {string} historyFilePath
 * @returns {Promise<string[]>}
 */
async function loadHistory(historyFilePath) {
  try {
    const raw = await readFile(historyFilePath, "utf8");
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-200);
  } catch {
    return [];
  }
}

/**
 * @param {string} historyFilePath
 * @param {string} line
 * @returns {Promise<void>}
 */
async function appendHistoryLine(historyFilePath, line) {
  const value = line.trim();

  if (!value) {
    return;
  }

  await mkdir(path.dirname(historyFilePath), { recursive: true });
  await appendFile(historyFilePath, `${value}\n`, "utf8");
}

/**
 * @param {string} text
 * @returns {number | null}
 */
function toFiniteNumberOrNull(text) {
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {string | undefined} stdout
 * @returns {{ usedTokens: number | null, tokenBudget: number | null }}
 */
function extractTokenSignals(stdout) {
  const output = String(stdout ?? "");

  if (!output.trim()) {
    return {
      usedTokens: null,
      tokenBudget: null
    };
  }

  const textMatch = output.match(/Token budget used:\s*(\d+)\s*\/\s*(\d+)/iu);
  if (textMatch) {
    return {
      usedTokens: toFiniteNumberOrNull(textMatch[1]),
      tokenBudget: toFiniteNumberOrNull(textMatch[2])
    };
  }

  try {
    const parsed = JSON.parse(output);
    const metadata = parsed?.metadata ?? parsed;
    const usage = metadata?.usage ?? parsed?.usage ?? {};
    const used = toFiniteNumberOrNull(usage.usedTokens ?? usage.outputTokens ?? parsed?.usedTokens);
    const budget = toFiniteNumberOrNull(usage.tokenBudget ?? parsed?.tokenBudget ?? metadata?.tokenBudget);

    return {
      usedTokens: used,
      tokenBudget: budget
    };
  } catch {
    return {
      usedTokens: null,
      tokenBudget: null
    };
  }
}

/**
 * @param {{
 *   telemetryFilePath: string,
 *   rawLine: string,
 *   command: string,
 *   durationMs: number,
 *   exitCode: number,
 *   stdout?: string
 * }} entry
 * @returns {Promise<void>}
 */
async function appendTelemetryLine(entry) {
  const taskKey = String(entry.rawLine ?? "").trim();
  const normalizedTask = taskKey.startsWith("/") ? taskKey.slice(1).trim() : taskKey;

  if (!normalizedTask) {
    return;
  }

  const tokens = extractTokenSignals(entry.stdout);
  const payload = {
    recordedAt: new Date().toISOString(),
    taskKey: normalizedTask.toLowerCase(),
    command: String(entry.command ?? "").trim().toLowerCase(),
    durationMs: Math.max(0, Math.round(Number(entry.durationMs) || 0)),
    exitCode: Number(entry.exitCode) || 0,
    usedTokens: tokens.usedTokens,
    tokenBudget: tokens.tokenBudget
  };

  await mkdir(path.dirname(entry.telemetryFilePath), { recursive: true });
  await appendFile(entry.telemetryFilePath, `${JSON.stringify(payload)}\n`, "utf8");
}

/**
 * @param {{
 *   command: string,
 *   args: string[],
 *   cwd: string
 * }} input
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
async function runExternalProcess(input) {
  try {
    const result = await execFile(input.command, input.args, {
      cwd: input.cwd,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024
    });

    return {
      exitCode: 0,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? "")
    };
  } catch (error) {
    const typed = /** @type {{
     *   code?: string | number,
     *   stdout?: string,
     *   stderr?: string,
     *   message?: string
     * }} */ (error);
    const exitCode = typeof typed.code === "number" ? typed.code : 1;

    return {
      exitCode,
      stdout: String(typed.stdout ?? ""),
      stderr: String(typed.stderr ?? typed.message ?? "Command execution failed.")
    };
  }
}

/**
 * @param {RunShellInput} input
 * @returns {Promise<{ exitCode: number, stdout: string }>}
 */
export async function runShellCommand(input) {
  const stdin = input.stdin ?? process.stdin;
  const stdout = input.stdout ?? process.stdout;
  const stderr = input.stderr ?? process.stderr;
  const usageText = input.usageText ?? (() => "");
  const cwd = input.cwd ?? process.cwd();

  if (!stdin.isTTY) {
    write(stderr, "NEXUS shell requires an interactive TTY session.");
    return {
      exitCode: 1,
      stdout: ""
    };
  }

  const interactivePrompt = Boolean(stdin.isTTY && stdout.isTTY);

  const state = createShellState({
    cwd,
    session: {
      project: input.options.project ?? "",
      workspace: input.options.workspace ?? ".",
      memoryBackend: normalizeMemoryBackend(input.options["memory-backend"]),
      format: normalizeFormat(input.options.format)
    }
  });
  const color = supportsAnsi(stdout);
  const renderMode = normalizeShellRenderMode(process.env.NEXUS_SHELL_RENDER_MODE);
  const menu = createShellMenuState();
  let commandInFlight = false;
  let menuSelectionInFlight = false;
  let lastBusyNoticeAt = 0;
  let lastRenderSignature = "";

  const history = await loadHistory(state.historyFilePath);
  const slashCompletions = [
    "/help",
    "/exit",
    "/tab recall",
    "/tab teach",
    "/tab remember",
    "/tab doctor",
    "/tab select",
    "/set project ",
    "/set workspace ",
    "/set backend resilient",
    "/set backend engram-only",
    "/set backend local-only",
    "/set format text",
    "/set format json",
    "/status",
    "/menu",
    "/menu skills",
    "/menu nexus",
    "/skills",
    "/nexus",
    "/clear",
    "/recall ",
    "/teach ",
    "/remember ",
    "/doctor",
    "/select "
  ];

  const rl = /** @type {readline.Interface & { history: string[] }} */ (readline.createInterface({
    input: stdin,
    output: stdout,
    historySize: 500,
    /**
     * @param {string} line
     */
    completer: (line) => {
      const hits = slashCompletions.filter((entry) => entry.startsWith(line));
      return [hits.length ? hits : slashCompletions, line];
    }
  }));

  if (history.length > 0) {
    rl.history = [...history].reverse();
  }

  const applyPrompt = () => {
    rl.setPrompt(renderPrompt(state, { color }));
  };

  const normalizeMenuIndex = () => {
    const items = getShellMenuItems(menu, state);
    if (items.length === 0) {
      menu.selectedIndex = 0;
      return;
    }

    menu.selectedIndex = Math.max(0, Math.min(items.length - 1, menu.selectedIndex));
  };

  const refreshGeneratedSkills = async (notice = "") => {
    menu.generatedSkills = await loadGeneratedSkillEntries(cwd);
    menu.lastUpdatedAt = new Date().toISOString().slice(11, 19);
    if (notice) {
      menu.notice = notice;
    }
    normalizeMenuIndex();
  };

  const buildRenderSignature = () => [
    state.activeTab,
    state.session.project,
    state.session.workspace,
    state.session.memoryBackend,
    state.session.format,
    menu.open ? "1" : "0",
    menu.section,
    String(menu.selectedIndex),
    menu.focusedSkillName,
    menu.lastUpdatedAt,
    String(menu.generatedSkills.length),
    menu.notice
  ].join("|");

  /**
   * Clear terminal in a cross-platform way (PowerShell/Windows Terminal included).
   * @returns {void}
   */
  const clearInteractiveScreen = () => {
    if (!interactivePrompt) {
      return;
    }

    const ttyOut = /** @type {NodeJS.WriteStream & {
     *   cursorTo?: (x: number, y?: number) => boolean,
     *   clearScreenDown?: () => boolean
     * }} */ (stdout);

    try {
      if (typeof ttyOut.cursorTo === "function" && typeof ttyOut.clearScreenDown === "function") {
        ttyOut.cursorTo(0, 0);
        ttyOut.clearScreenDown();
        return;
      }
    } catch {
      // fallback below
    }

    try {
      readline.cursorTo(stdout, 0, 0);
      readline.clearScreenDown(stdout);
      return;
    } catch {
      // fallback below
    }

    try {
      console.clear();
      return;
    } catch {
      // fallback below
    }

    stdout.write("\x1b[2J\x1b[H");
  };

  const promptWithoutRedraw = () => {
    try {
      applyPrompt();
      rl.prompt(true);
    } catch (error) {
      const message = String(/** @type {{ message?: string }} */ (error)?.message ?? "");
      const benignClose = message.toLowerCase().includes("readline was closed");

      if (!benignClose) {
        throw error;
      }
    }
  };

  /**
   * @param {ShellRenderReason} reason
   * @returns {void}
   */
  const redrawDashboard = (reason = "layout") => {
    if (!interactivePrompt) {
      return;
    }

    normalizeMenuIndex();
    const signature = buildRenderSignature();
    const stateChanged = signature !== lastRenderSignature;
    const policy = evaluateDashboardRenderPolicy({
      renderMode,
      reason,
      stateChanged
    });

    if (!policy.redraw) {
      promptWithoutRedraw();
      return;
    }

    if (policy.clear) {
      clearInteractiveScreen();
    }

    write(stdout, renderShellBanner(state, { color }));
    write(stdout, renderActiveTabHint(state, { color }));

    if (menu.open) {
      write(stdout, renderShellMenu(menu, state, { color }));
    } else {
      write(stdout, ansi("menu hidden • press /menu or M to show", "38;5;244", color));
    }

    lastRenderSignature = signature;
    promptWithoutRedraw();
  };

  const notifyCommandBusy = () => {
    const now = Date.now();
    if (now - lastBusyNoticeAt < 450) {
      return;
    }

    lastBusyNoticeAt = now;
    menu.notice = "Comando en ejecucion. Espera a que finalice.";
    write(stdout, "\nComando en ejecucion. Espera a que finalice.");
    promptWithoutRedraw();
  };

  /**
   * @template T
   * @param {() => Promise<T>} runner
   * @returns {Promise<T | null>}
   */
  const runWithCommandLock = async (runner) => {
    if (commandInFlight) {
      notifyCommandBusy();
      return null;
    }

    commandInFlight = true;

    try {
      return await runner();
    } finally {
      commandInFlight = false;
      lastBusyNoticeAt = 0;
    }
  };

  await refreshGeneratedSkills();
  if (interactivePrompt) {
    redrawDashboard("initial");
  } else {
    write(stdout, renderShellBanner(state, { color }));
    write(stdout, renderActiveTabHint(state, { color }));
    if (menu.open) {
      write(stdout, renderShellMenu(menu, state, { color }));
    }
  }

  const runMenuSelection = async () => {
    if (menuSelectionInFlight || commandInFlight) {
      notifyCommandBusy();
      return;
    }

    menuSelectionInFlight = true;
    try {
      const shouldRedraw = await executeSelectedMenuItem();
      if (shouldRedraw) {
        redrawDashboard("layout");
      } else {
        promptWithoutRedraw();
      }
    } catch (error) {
      const message = String(/** @type {{ message?: string }} */ (error)?.message ?? "menu action failed");
      menu.notice = `Error accion menu: ${message}`;
      redrawDashboard("layout");
    } finally {
      menuSelectionInFlight = false;
    }
  };

  /**
   * @param {string} _value
   * @param {{ name?: string, ctrl?: boolean, meta?: boolean } | undefined} key
   */
  const onKeypress = (_value, key) => {
    const lineBuffer = normalizeInteractiveLine(String(rl.line ?? ""));
    const canCaptureMenuNav = !lineBuffer && !key?.ctrl && !key?.meta;

    if (shouldBlockMenuInteractionWhileBusy({
      commandInFlight,
      canCaptureMenuNav,
      keyName: key?.name
    })) {
      notifyCommandBusy();
      return;
    }

    if (canCaptureMenuNav && key?.name === "m") {
      menu.open = !menu.open;
      menu.notice = menu.open ? "Menu activo." : "Menu oculto.";
      redrawDashboard("layout");
      return;
    }

    if (canCaptureMenuNav && key?.name === "s") {
      menu.open = true;
      menu.section = "skills";
      menu.selectedIndex = 0;
      menu.notice = "Skills manager activo.";
      redrawDashboard("layout");
      return;
    }

    if (canCaptureMenuNav && key?.name === "n") {
      menu.open = true;
      menu.section = "nexus";
      menu.selectedIndex = 0;
      menu.notice = "NEXUS root activo.";
      redrawDashboard("layout");
      return;
    }

    if (
      canCaptureMenuNav &&
      menu.open &&
      (key?.name === "down" || key?.name === "j")
    ) {
      const items = getShellMenuItems(menu, state);
      if (items.length > 0) {
        menu.selectedIndex = (menu.selectedIndex + 1) % items.length;
        redrawDashboard("navigation");
      }
      return;
    }

    if (
      canCaptureMenuNav &&
      menu.open &&
      (key?.name === "up" || key?.name === "k")
    ) {
      const items = getShellMenuItems(menu, state);
      if (items.length > 0) {
        menu.selectedIndex = (menu.selectedIndex - 1 + items.length) % items.length;
        redrawDashboard("navigation");
      }
      return;
    }

    if (canCaptureMenuNav && menu.open && (key?.name === "return" || key?.name === "enter")) {
      void runMenuSelection();
      return;
    }

    if (
      (key?.name === "tab" && !key.ctrl && !key.meta) ||
      key?.name === "right"
    ) {
      state.activeTab = nextTab(state.activeTab);
      menu.notice = `Tab activa: ${state.activeTab}`;
      redrawDashboard("navigation");
      return;
    }

    if (key?.name === "left") {
      state.activeTab = previousTab(state.activeTab);
      menu.notice = `Tab activa: ${state.activeTab}`;
      redrawDashboard("navigation");
      return;
    }

    if (key?.ctrl && key?.name === "l") {
      redrawDashboard("manual-clear");
    }
  };

  /**
   * @param {{
   *   label: string,
   *   commandName: string,
   *   rawLine: string,
   *   durationMs: number,
   *   result: { exitCode: number, stdout?: string, stderr?: string }
   * }} inputExecution
   * @returns {Promise<void>}
   */
  const renderExecutionResult = async (inputExecution) => {
    state.commandCount += 1;

    try {
      await appendTelemetryLine({
        telemetryFilePath: state.telemetryFilePath,
        rawLine: inputExecution.rawLine,
        command: inputExecution.commandName,
        durationMs: inputExecution.durationMs,
        exitCode: inputExecution.result.exitCode,
        stdout: inputExecution.result.stdout
      });
    } catch {
      // telemetry failures must never break command execution
    }

    if (inputExecution.result.stdout && inputExecution.result.stdout.trim()) {
      write(stdout, `\n${inputExecution.result.stdout.trim()}`);
    }

    if (inputExecution.result.stderr && inputExecution.result.stderr.trim()) {
      write(stderr, `\n${inputExecution.result.stderr.trim()}`);
    }

    const ok = inputExecution.result.exitCode === 0;
    const icon = ok ? ansi("✔", "32", color) : ansi("✖", "31", color);
    const status = ok ? ansi("ok", "32", color) : ansi("fail", "31", color);
    write(
      stdout,
      `\n${icon} [${status}] ${inputExecution.label} (${inputExecution.commandName}) · ${inputExecution.durationMs}ms · exit ${inputExecution.result.exitCode}`
    );
  };

  /**
   * @param {{ argv: string[], label: string, rawLine: string }} inputExecution
   * @returns {Promise<{ exitCode: number, commandName: string, durationMs: number }>}
   */
  const executeCliAction = async (inputExecution) => {
    await appendHistoryLine(state.historyFilePath, inputExecution.rawLine);

    const commandName = inputExecution.argv[0] ?? "";
    if (commandName === "shell") {
      write(stderr, "\nNested shell is not allowed.");
      return {
        exitCode: 1,
        commandName,
        durationMs: 0
      };
    }

    const startedAt = Date.now();
    const result = await input.runCli(inputExecution.argv);
    const durationMs = Date.now() - startedAt;

    await renderExecutionResult({
      label: inputExecution.label,
      commandName,
      rawLine: inputExecution.rawLine,
      durationMs,
      result
    });

    return {
      exitCode: result.exitCode,
      commandName,
      durationMs
    };
  };

  /**
   * @param {{ command: string, args: string[], label: string, rawLine: string }} inputExecution
   * @returns {Promise<{ exitCode: number, commandName: string, durationMs: number }>}
   */
  const executeScriptAction = async (inputExecution) => {
    await appendHistoryLine(state.historyFilePath, inputExecution.rawLine);

    const startedAt = Date.now();
    const result = await runExternalProcess({
      command: inputExecution.command,
      args: inputExecution.args,
      cwd
    });
    const durationMs = Date.now() - startedAt;

    await renderExecutionResult({
      label: inputExecution.label,
      commandName: inputExecution.command,
      rawLine: inputExecution.rawLine,
      durationMs,
      result
    });

    return {
      exitCode: result.exitCode,
      commandName: inputExecution.command,
      durationMs
    };
  };

  /**
   * @param {GeneratedSkillEntry} skill
   * @returns {Promise<void>}
   */
  const showSkillDetails = async (skill) => {
    const resolvedPath = skill.filePath
      ? path.resolve(cwd, skill.filePath)
      : path.resolve(cwd, "skills", "generated", skill.name, "SKILL.md");
    const raw = await readFile(resolvedPath, "utf8").catch(() => "");
    const preview = raw
      .split(/\r?\n/gu)
      .slice(0, 18)
      .join("\n");

    write(
      stdout,
      [
        "",
        `Skill: ${skill.name}`,
        `Status: ${skill.status}`,
        `Occurrences: ${skill.occurrences}`,
        `Updated: ${skill.updatedAt || "n/a"}`,
        `Path: ${resolvedPath}`,
        "",
        "Preview:",
        preview || "(skill file not found)"
      ].join("\n")
    );
  };

  /**
   * @param {GeneratedSkillEntry} skill
   * @returns {Promise<void>}
   */
  const showSkillFile = async (skill) => {
    const resolvedPath = skill.filePath
      ? path.resolve(cwd, skill.filePath)
      : path.resolve(cwd, "skills", "generated", skill.name, "SKILL.md");
    const raw = await readFile(resolvedPath, "utf8").catch(() => "");

    write(
      stdout,
      [
        "",
        `Skill file: ${resolvedPath}`,
        "",
        raw || "(skill file not found)"
      ].join("\n")
    );
  };

  /**
   * @returns {Promise<{ registryPath: string, registry: { version: number, generatedAt: string, skills: any[] } }>}
   */
  const loadSkillRegistry = async () => {
    const registryPath = path.resolve(cwd, "skills", "generated", "registry.json");
    const parsed = await readJsonIfPresent(registryPath);
    const fallback = {
      version: 1,
      generatedAt: new Date().toISOString(),
      skills: []
    };

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(/** @type {{ skills?: unknown[] }} */ (parsed).skills)
    ) {
      return {
        registryPath,
        registry: fallback
      };
    }

    const registry = /** @type {{ version?: number, generatedAt?: string, skills?: any[] }} */ (parsed);

    return {
      registryPath,
      registry: {
        version: Number(registry.version ?? 1) || 1,
        generatedAt: compact(String(registry.generatedAt ?? "")) || new Date().toISOString(),
        skills: Array.isArray(registry.skills) ? registry.skills : []
      }
    };
  };

  /**
   * @param {string} registryPath
   * @param {{ version: number, generatedAt: string, skills: any[] }} registry
   * @returns {Promise<void>}
   */
  const saveSkillRegistry = async (registryPath, registry) => {
    await mkdir(path.dirname(registryPath), { recursive: true });
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  };

  /**
   * @param {string} skillName
   * @param {"experimental" | "stable"} nextStatus
   * @returns {Promise<{ ok: boolean, message: string }>}
   */
  const promoteSkillManually = async (skillName, nextStatus) => {
    const { registryPath, registry } = await loadSkillRegistry();
    const target = registry.skills.find(
      (entry) => compact(String(entry?.name ?? "")).toLowerCase() === skillName.toLowerCase()
    );

    if (!target) {
      return {
        ok: false,
        message: `Skill '${skillName}' no existe en skills/generated/registry.json.`
      };
    }

    const now = new Date().toISOString();
    target.status = nextStatus;
    target.updatedAt = now;
    target.promotion = {
      ...(target.promotion ?? {}),
      lastEvaluatedAt: now,
      decision: nextStatus === "stable" ? "manual-promoted-stable" : "manual-promoted-experimental",
      reasons: [`manual-promotion:${nextStatus}`]
    };
    registry.generatedAt = now;

    await saveSkillRegistry(registryPath, registry);
    await refreshGeneratedSkills();

    return {
      ok: true,
      message: `Skill '${skillName}' promovida manualmente a ${nextStatus}.`
    };
  };

  /**
   * @param {string} skillName
   * @returns {Promise<{ ok: boolean, message: string }>}
   */
  const archiveSkill = async (skillName) => {
    const skill = menu.generatedSkills.find((entry) => entry.name.toLowerCase() === skillName.toLowerCase());

    if (!skill) {
      return {
        ok: false,
        message: `Skill '${skillName}' no encontrada en el catalogo actual.`
      };
    }

    const skillFilePath = skill.filePath
      ? path.resolve(cwd, skill.filePath)
      : path.resolve(cwd, "skills", "generated", skill.name, "SKILL.md");
    const sourceDir = path.dirname(skillFilePath);

    if (!(await pathExists(sourceDir))) {
      return {
        ok: false,
        message: `No existe la ruta para archivar: ${sourceDir}`
      };
    }

    const archiveRoot = path.resolve(cwd, "skills", "archive");
    await mkdir(archiveRoot, { recursive: true });
    const baseTarget = path.join(archiveRoot, path.basename(sourceDir));

    let targetDir = baseTarget;
    let suffix = 1;
    while (await pathExists(targetDir)) {
      targetDir = `${baseTarget}-${suffix}`;
      suffix += 1;
    }

    await rename(sourceDir, targetDir);

    const { registryPath, registry } = await loadSkillRegistry();
    const before = registry.skills.length;
    registry.skills = registry.skills.filter(
      (entry) => compact(String(entry?.name ?? "")).toLowerCase() !== skillName.toLowerCase()
    );
    if (registry.skills.length !== before) {
      registry.generatedAt = new Date().toISOString();
      await saveSkillRegistry(registryPath, registry);
    }

    if (menu.focusedSkillName.toLowerCase() === skillName.toLowerCase()) {
      menu.section = "skills";
      menu.focusedSkillName = "";
      menu.selectedIndex = 0;
    }

    await refreshGeneratedSkills();

    return {
      ok: true,
      message: `Skill archivada en ${path.relative(cwd, targetDir).replaceAll("\\", "/")}.`
    };
  };

  /**
   * @returns {Promise<boolean>}
   */
  const executeSelectedMenuItem = async () => {
    const selected = getSelectedShellMenuItem(menu, state);
    if (!selected) {
      return true;
    }

    const action = selected.action;

    if (action.type === "switch-tab") {
      state.activeTab = action.tab;
      menu.notice = `Tab activa: ${action.tab}`;
      return true;
    }

    if (action.type === "open-section") {
      menu.section = action.section;
      menu.selectedIndex = 0;
      if (action.section !== "skill-actions") {
        menu.focusedSkillName = "";
      }
      menu.notice = action.section === "skills"
        ? "Skills manager activo."
        : action.section === "skill-actions"
          ? `Gestionando skill: ${menu.focusedSkillName || "n/a"}`
          : `Submenu activo: ${formatMenuSectionLabel(action.section)}`;
      return true;
    }

    if (action.type === "open-skill-actions") {
      menu.section = "skill-actions";
      menu.focusedSkillName = action.skill.name;
      menu.selectedIndex = 0;
      menu.notice = `Gestionando skill: ${action.skill.name}`;
      return true;
    }

    if (action.type === "refresh-skills") {
      await refreshGeneratedSkills("Skills recargadas.");
      return true;
    }

    if (action.type === "show-help") {
      write(stdout, `\n${renderShellHelp(state)}`);
      write(stdout, usageText());
      menu.notice = "Opciones NEXUS mostradas.";
      return !shouldPreserveMenuActionOutput(action.type);
    }

    if (action.type === "show-skill") {
      await showSkillDetails(action.skill);
      menu.notice = `Vista skill: ${action.skill.name}`;
      return !shouldPreserveMenuActionOutput(action.type);
    }

    if (action.type === "show-skill-file") {
      await showSkillFile(action.skill);
      menu.notice = `Archivo abierto: ${action.skill.name}`;
      return !shouldPreserveMenuActionOutput(action.type);
    }

    if (action.type === "promote-skill") {
      const result = await promoteSkillManually(action.skillName, action.status);
      menu.notice = result.message;
      return true;
    }

    if (action.type === "archive-skill") {
      const result = await archiveSkill(action.skillName);
      menu.notice = result.message;
      return true;
    }

    if (action.type === "run-cli") {
      const execution = await runWithCommandLock(() => executeCliAction({
        argv: action.argv,
        label: `[menu] ${selected.label}`,
        rawLine: action.rawLine
      }));

      if (!execution) {
        return false;
      }

      await refreshGeneratedSkills();
      menu.notice = `[${execution.exitCode === 0 ? "ok" : "fail"}] ${action.rawLine} (exit ${execution.exitCode})`;
      return !shouldPreserveMenuActionOutput(action.type);
    }

    if (action.type === "run-script") {
      const execution = await runWithCommandLock(() => executeScriptAction({
        command: action.command,
        args: action.args,
        label: `[menu] ${selected.label}`,
        rawLine: action.rawLine
      }));

      if (!execution) {
        return false;
      }

      await refreshGeneratedSkills();
      menu.notice = `[${execution.exitCode === 0 ? "ok" : "fail"}] ${action.rawLine} (exit ${execution.exitCode})`;
      return !shouldPreserveMenuActionOutput(action.type);
    }

    return true;
  };

  const stdinAsKeypressTarget = /** @type {NodeJS.ReadStream & { setRawMode?: (value: boolean) => void }} */ (stdin);
  let rawModeEnabled = false;

  try {
    if (stdin.isTTY) {
      readline.emitKeypressEvents(stdin, rl);

      if (typeof stdinAsKeypressTarget.setRawMode === "function") {
        stdinAsKeypressTarget.setRawMode(true);
        rawModeEnabled = true;
      }

      stdin.on("keypress", onKeypress);
    }

    try {
      for await (const line of rl) {
        const normalizedLine = normalizeInteractiveLine(line);

        if (shouldIgnoreMenuReadlineLine({ menuOpen: menu.open, line: normalizedLine })) {
          // Enter/menu selection is handled via keypress to avoid duplicate dispatch
          // from readline line events in some terminals.
          continue;
        }

        const action = resolveShellInput(normalizedLine, state);

        if (action.kind === "noop") {
          promptWithoutRedraw();
          continue;
        }

        if (action.kind === "menu") {
          if (action.toggle) {
            menu.open = !menu.open;
          }

          if (typeof action.open === "boolean") {
            menu.open = action.open;
          }

          if (action.section) {
            menu.section = action.section;
            menu.selectedIndex = 0;
          }

          menu.notice = menu.open
            ? `Menu abierto (${formatMenuSectionLabel(menu.section)}).`
            : "Menu oculto.";
          redrawDashboard("layout");
          continue;
        }

        if (action.kind === "exit") {
          break;
        }

        if (action.kind === "help") {
          write(stdout, `\n${renderShellHelp(state)}`);
          write(stdout, usageText());
          menu.notice = "Opciones NEXUS mostradas.";
          promptWithoutRedraw();
          continue;
        }

        if (action.kind === "status") {
          write(stdout, `\n${renderShellStatus(state, { color })}`);
          menu.notice = "Status actualizado.";
          promptWithoutRedraw();
          continue;
        }

        if (action.kind === "clear") {
          redrawDashboard("manual-clear");
          continue;
        }

        if (action.kind === "error") {
          write(stderr, `\n${action.message}`);
          promptWithoutRedraw();
          continue;
        }

        if (action.kind === "info") {
          write(stdout, `\n${action.message}`);

          if (action.message.startsWith("Tab active:")) {
            menu.notice = action.message;
          }

          promptWithoutRedraw();
          continue;
        }

        const execution = await runWithCommandLock(() => executeCliAction({
          argv: action.argv,
          label: action.label,
          rawLine: normalizedLine || line
        }));

        if (!execution) {
          continue;
        }

        if (menu.section === "skills") {
          await refreshGeneratedSkills();
        }

        menu.notice = `[${execution.exitCode === 0 ? "ok" : "fail"}] ${action.label} (exit ${execution.exitCode})`;
        promptWithoutRedraw();
      }
    } catch (error) {
      const message = String(/** @type {{ message?: string }} */ (error)?.message ?? "");
      const benignClose = message.toLowerCase().includes("readline was closed");

      if (!benignClose) {
        throw error;
      }
    }
  } finally {
    rl.close();

    if (stdin.isTTY) {
      stdin.off("keypress", onKeypress);
    }

    if (rawModeEnabled && typeof stdinAsKeypressTarget.setRawMode === "function") {
      stdinAsKeypressTarget.setRawMode(false);
    }
  }

  const duration = Date.now() - state.startedAt;
  write(
    stdout,
    `\nShell session ended. commands=${state.commandCount} durationMs=${duration}\n`
  );

  return {
    exitCode: 0,
    stdout: ""
  };
}
