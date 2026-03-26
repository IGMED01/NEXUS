// @ts-check

import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";

/** @typedef {"recall" | "teach" | "remember" | "doctor" | "select"} ShellTabId */
/** @typedef {"resilient" | "engram-only" | "local-only"} MemoryBackendMode */
/** @typedef {"text" | "json"} OutputFormat */

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
 *   session: ShellSessionConfig,
 *   historyFilePath: string,
 *   commandCount: number,
 *   startedAt: number
 * }} ShellState
 */

/**
 * @typedef {{
 *   kind: "noop"
 * } | {
 *   kind: "help"
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
 * @returns {ShellTabId}
 */
function normalizeTab(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return SHELL_TABS.some((tab) => tab.id === normalized)
    ? /** @type {ShellTabId} */ (normalized)
    : "recall";
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
  const historyFilePath =
    input.historyFilePath ??
    path.resolve(cwd, ".lcs", "shell-history");
  const commandCount =
    typeof input.commandCount === "number" && Number.isFinite(input.commandCount)
      ? input.commandCount
      : 0;
  const startedAt =
    typeof input.startedAt === "number" && Number.isFinite(input.startedAt)
      ? input.startedAt
      : Date.now();

  return {
    activeTab: normalizeTab(input.activeTab),
    session: {
      project: input.session?.project ?? "",
      workspace: input.session?.workspace ?? ".",
      memoryBackend: normalizeMemoryBackend(input.session?.memoryBackend),
      format: normalizeFormat(input.session?.format)
    },
    historyFilePath,
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
 * @param {ShellState} state
 * @returns {string}
 */
export function renderShellTabs(state) {
  return SHELL_TABS
    .map((tab) => {
      if (tab.id === state.activeTab) {
        return `\x1b[30;47m ${tab.label} \x1b[0m`;
      }

      return `\x1b[2m ${tab.label} \x1b[0m`;
    })
    .join(" ");
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

    if (command === "exit" || command === "quit") {
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
    "- /exit               close shell",
    `- /tab <${tabNames}>  switch active tab`,
    "- /set project <name>",
    "- /set workspace <dir>",
    "- /set backend <resilient|engram-only|local-only>",
    "- /set format <text|json>",
    "- /recall <query>     run recall quickly",
    "- /teach <text>       quick teach task/objective",
    "- /remember <text>    save durable note",
    "- /doctor             run doctor",
    "- /select <focus>     run selector",
    "",
    `Current tab: ${state.activeTab}`,
    "Tip: press TAB to rotate tabs and type plain text to execute the active tab."
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
 * @param {RunShellInput} input
 * @returns {Promise<{ exitCode: number, stdout: string }>}
 */
export async function runShellCommand(input) {
  const stdin = input.stdin ?? process.stdin;
  const stdout = input.stdout ?? process.stdout;
  const stderr = input.stderr ?? process.stderr;
  const usageText = input.usageText ?? (() => "");
  const cwd = input.cwd ?? process.cwd();

  const state = createShellState({
    cwd,
    session: {
      project: input.options.project ?? "",
      workspace: input.options.workspace ?? ".",
      memoryBackend: normalizeMemoryBackend(input.options["memory-backend"]),
      format: normalizeFormat(input.options.format)
    }
  });

  write(stdout, "\nNEXUS interactive shell");
  write(stdout, "Type /help for commands. Press TAB to switch tabs.");
  write(
    stdout,
    `Session: project=${state.session.project || "(none)"} backend=${state.session.memoryBackend} format=${state.session.format}`
  );
  write(stdout, renderShellTabs(state));

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
    rl.setPrompt(`nexus[${state.activeTab}]> `);
  };

  applyPrompt();
  rl.prompt();

  /**
   * @param {string} _value
   * @param {{ name?: string, ctrl?: boolean, meta?: boolean } | undefined} key
   */
  const onKeypress = (_value, key) => {
    if (key?.name === "tab" && !key.ctrl && !key.meta) {
      state.activeTab = nextTab(state.activeTab);
      applyPrompt();
      write(stdout, `\n${renderShellTabs(state)}`);
      rl.prompt(true);
    }
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

    for await (const line of rl) {
      const action = resolveShellInput(line, state);

      if (action.kind === "noop") {
        rl.prompt();
        continue;
      }

      if (action.kind === "exit") {
        break;
      }

      if (action.kind === "help") {
        write(stdout, `\n${renderShellHelp(state)}`);
        write(stdout, usageText());
        rl.prompt();
        continue;
      }

      if (action.kind === "error") {
        write(stderr, `\n${action.message}`);
        rl.prompt();
        continue;
      }

      if (action.kind === "info") {
        write(stdout, `\n${action.message}`);
        rl.prompt();
        continue;
      }

      await appendHistoryLine(state.historyFilePath, line);

      const commandName = action.argv[0] ?? "";

      if (commandName === "shell") {
        write(stderr, "\nNested shell is not allowed.");
        rl.prompt();
        continue;
      }

      const startedAt = Date.now();
      const result = await input.runCli(action.argv);
      const durationMs = Date.now() - startedAt;
      state.commandCount += 1;

      if (result.stdout && result.stdout.trim()) {
        write(stdout, `\n${result.stdout.trim()}`);
      }

      if (result.stderr && result.stderr.trim()) {
        write(stderr, `\n${result.stderr.trim()}`);
      }

      const status = result.exitCode === 0 ? "\x1b[32mok\x1b[0m" : "\x1b[31mfail\x1b[0m";
      write(
        stdout,
        `\n[${status}] ${action.label} (${commandName}) in ${durationMs}ms · exit ${result.exitCode}`
      );
      rl.prompt();
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
