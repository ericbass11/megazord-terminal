/**
 * Criterion 11 is "the provider list is discovered from `PATH`, not hardcoded — proven by it changing
 * when a CLI is removed", and these tests prove it against a **real file system**, never a mock.
 *
 * Three kinds of evidence, and the split is deliberate:
 *
 * - **Fixture directories.** A real file is written into a temporary directory, made executable with a
 *   real `chmod`, and found through a `PATH` that names that directory. Then it is deleted and the same
 *   lookup answers absent. Nothing here stubs `node:fs`: a test that mocked the file system would prove
 *   the mock agrees with itself, and every interesting case below — a directory named like a CLI, a
 *   non-executable file, a dangling symbolic link — is a fact about the kernel rather than about this
 *   module's arithmetic.
 * - **The real machine `PATH`.** `providersIn(hostLookup())` is compared against an **independent
 *   oracle**: `sh -c 'command -v <cli>'`, which is the shell's own answer to the same question. Pinning
 *   the literal path this was written on (`/opt/node22/bin/claude`) would be a test that fails on the
 *   next machine, so what is pinned is *agreement with the operating system* — which is the stronger
 *   claim, and it fails the moment this module's rules and a shell's diverge. The literal answer of the
 *   machine it was written on is in the Handoff.
 * - **`candidatesFor` over Windows rules.** The `;` separator, quoted entries and `PATHEXT` are pure
 *   string work, so both platforms' rules are proven on whatever host runs the suite. The file-system
 *   half of the Windows path is a declared Gap — see the module doc of `providers.ts`.
 *
 * Every directory this file creates is under `tmpdir()` and is removed afterwards; the last test asserts
 * both, because a detection test that left a fake `claude` behind on somebody's `PATH` would be its own
 * bug report.
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { EFFORTS, type Harness } from "@engine/index";

import {
  InvalidProviderCatalogError,
  InvalidProviderLookupError,
  PROVIDER_CATALOG,
  candidatesFor,
  hostLookup,
  presentIn,
  providersIn,
  type AbsentProvider,
  type PresentProvider,
  type Provider,
  type ProviderCatalogEntry,
  type ProviderLookup,
} from "./providers";

/* -------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

const created: string[] = [];

/** A directory of this run's own, removed at the end whatever happens. */
function temporary(): string {
  const made = mkdtempSync(join(tmpdir(), "megazord-providers-"));
  created.push(made);
  return made;
}

/** A real, runnable file. `chmod` and not a flag on `writeFileSync`: the mode is the thing under test. */
function executableAt(directory: string, name: string): string {
  const path = join(directory, name);
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
}

/** A real file that nobody may execute. 0o644 has no execute bit at all, so even root is refused. */
function plainFileAt(directory: string, name: string): string {
  const path = join(directory, name);
  writeFileSync(path, "not a program\n");
  chmodSync(path, 0o644);
  return path;
}

/** A POSIX lookup over one or more fixture directories, in order. */
function lookupOver(...directories: readonly string[]): ProviderLookup {
  return { path: directories.join(":"), platform: "linux" };
}

afterAll(() => {
  for (const made of created) {
    rmSync(made, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------------------------------
 * A Catalog a test owns
 * ---------------------------------------------------------------------------------------------- */

/**
 * The three built-in providers, spelled out here rather than read from the module.
 *
 * The duplication is the point: a test that asked the module for its own Catalog would agree with it by
 * construction and pin nothing. The PRD and the techspec name these three, so these three are pinned.
 */
const BUILT_IN = ["claude", "codex", "gemini"] as const;

/** One entry, complete and valid, that a test can then break in exactly one way. */
function entry(overrides: Partial<ProviderCatalogEntry> = {}): ProviderCatalogEntry {
  return {
    id: "fake",
    name: "A Fake Provider",
    cli: "fake-cli",
    model: "fake-model",
    effort: "medium",
    skills: [],
    ...overrides,
  };
}

/** The one provider of a single-entry Catalog, by id. */
function only(providers: readonly Provider[]): Provider {
  expect(providers).toHaveLength(1);
  const first = providers[0];
  if (first === undefined) {
    throw new Error("unreachable: the length was just asserted");
  }
  return first;
}

/** One provider of an answer, by id, or a failure that says which ids were there. */
function found(providers: readonly Provider[], id: string): Provider {
  const one = providers.find((provider) => provider.id === id);
  if (one === undefined) {
    throw new Error(`no provider named ${id}; the answer holds ${providers.map((p) => p.id).join(", ")}`);
  }
  return one;
}

/* -------------------------------------------------------------------------------------------------
 * The Catalog
 * ---------------------------------------------------------------------------------------------- */

describe("the Catalog", () => {
  it("knows the three CLIs the PRD names, and each once", () => {
    expect(PROVIDER_CATALOG.map((known) => known.id)).toEqual([...BUILT_IN]);
    expect(PROVIDER_CATALOG.map((known) => known.cli)).toEqual([...BUILT_IN]);
    expect(new Set(PROVIDER_CATALOG.map((known) => known.id)).size).toBe(PROVIDER_CATALOG.length);
  });

  it("carries the fields of a default and never a Harness, so cli has one source", async () => {
    // The entry's own key set: a `catalogDefault` here would be a second place `cli` is written down.
    for (const known of PROVIDER_CATALOG) {
      expect(Object.keys(known).sort()).toEqual(["cli", "effort", "id", "model", "name", "skills"]);
    }

    const providers = await providersIn({ path: "", platform: "linux" });
    for (const provider of providers) {
      expect(provider.catalogDefault.cli).toBe(provider.cli);
    }
  });

  it("resolves every default into a complete, checked, frozen Harness", async () => {
    // `path: ""` is a lookup with nowhere to look: every provider is absent, and every default is still
    // built — a Catalog default exists whether or not the CLI does.
    const providers = await providersIn({ path: "", platform: "linux" });

    expect(providers.map((provider) => provider.present)).toEqual([false, false, false]);
    for (const provider of providers) {
      const bundle: Harness = provider.catalogDefault;
      expect(Object.keys(bundle).sort()).toEqual(["cli", "effort", "model", "skills"]);
      expect(bundle.model.trim().length).toBeGreaterThan(0);
      expect(EFFORTS).toContain(bundle.effort);
      expect(bundle.skills).toEqual([]);
      expect(Object.isFrozen(bundle)).toBe(true);
    }
  });

  it("is data: a provider it has never heard of is detected with no change to the module", async () => {
    const bin = temporary();
    executableAt(bin, "ollama");

    const providers = await providersIn({
      ...lookupOver(bin),
      catalog: [entry({ id: "ollama", name: "Ollama", cli: "ollama", model: "llama3" })],
    });

    const ollama = only(providers);
    expect(ollama.present).toBe(true);
    expect(ollama.name).toBe("Ollama");
    expect(ollama.catalogDefault.cli).toBe("ollama");
  });

  it("reads an empty Catalog as an answer, not as silence", async () => {
    // The trap `CLAUDE.md` records about default parameters, in the shape it takes here: `catalog: []`
    // must mean "look for nothing" and not "use the built-in three".
    await expect(providersIn({ path: "", platform: "linux", catalog: [] })).resolves.toEqual([]);
    await expect(providersIn({ path: "", platform: "linux" })).resolves.toHaveLength(3);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Criterion 11
 * ---------------------------------------------------------------------------------------------- */

describe("criterion 11: the list is discovered from PATH", () => {
  it("finds a CLI that is there and loses it when it is removed", async () => {
    const bin = temporary();
    const path = executableAt(bin, "claude");
    const lookup = lookupOver(bin);

    const withIt = await providersIn(lookup);
    const claudeThere = found(withIt, "claude");
    expect(claudeThere.present).toBe(true);
    expect(claudeThere).toMatchObject({ present: true, id: "claude", cli: "claude", path });
    // The other two are not installed in the fixture, so the same run reports them absent.
    expect(found(withIt, "codex").present).toBe(false);
    expect(found(withIt, "gemini").present).toBe(false);
    expect(presentIn(withIt).map((provider) => provider.id)).toEqual(["claude"]);

    rmSync(path);

    const withoutIt = await providersIn(lookup);
    expect(found(withoutIt, "claude").present).toBe(false);
    expect(presentIn(withoutIt)).toEqual([]);
  });

  it("loses it when the PATH points elsewhere, with the file still on disk", async () => {
    const bin = temporary();
    const elsewhere = temporary();
    const path = executableAt(bin, "codex");

    expect(found(await providersIn(lookupOver(bin)), "codex")).toMatchObject({ present: true, path });
    expect(found(await providersIn(lookupOver(elsewhere)), "codex").present).toBe(false);
    expect(existsSync(path)).toBe(true);
  });

  it("answers one provider per Catalog entry, in Catalog order, present or not", async () => {
    const bin = temporary();
    executableAt(bin, "gemini");

    const providers = await providersIn(lookupOver(bin));

    expect(providers.map((provider) => provider.id)).toEqual([...BUILT_IN]);
    expect(providers.map((provider) => provider.present)).toEqual([false, false, true]);
  });

  it("hands out a frozen reading whose key set says whether there is a path", async () => {
    const bin = temporary();
    executableAt(bin, "claude");

    const providers = await providersIn(lookupOver(bin));
    const claudeThere = found(providers, "claude");
    const codexMissing = found(providers, "codex");

    expect(Object.keys(claudeThere).sort()).toEqual(["catalogDefault", "cli", "id", "name", "path", "present"]);
    // No `path`, and no `path: undefined` either: the absent member does not declare the field, so a
    // reader has to ask `present` before it can read one.
    expect(Object.keys(codexMissing).sort()).toEqual(["catalogDefault", "cli", "id", "name", "present"]);
    expect("path" in codexMissing).toBe(false);

    expect(Object.isFrozen(providers)).toBe(true);
    expect(Object.isFrozen(claudeThere)).toBe(true);
    expect(() => {
      // A reading is not a handle. The type refuses this too; the freeze is what stops a cast.
      (claudeThere as { path: string }).path = "/elsewhere";
    }).toThrow(TypeError);
    expect(Object.isFrozen(presentIn(providers))).toBe(true);
  });
});

/* -------------------------------------------------------------------------------------------------
 * What counts as executable
 * ---------------------------------------------------------------------------------------------- */

describe("what counts as executable", () => {
  it("refuses a file on PATH with no execute bit", async () => {
    const bin = temporary();
    const path = plainFileAt(bin, "claude");

    expect(existsSync(path)).toBe(true);
    expect(found(await providersIn(lookupOver(bin)), "claude").present).toBe(false);
  });

  it("refuses a directory named like a CLI, which is why isFile is checked", async () => {
    const bin = temporary();
    // On POSIX a directory carries the execute bit to mean "searchable", so `access(X_OK)` alone says
    // yes to this — including for root. Without the `stat().isFile()` half, this reports a provider.
    mkdirSync(join(bin, "gemini"));

    expect(found(await providersIn(lookupOver(bin)), "gemini").present).toBe(false);
  });

  it("follows a symbolic link to a program, the way the real claude is installed", async () => {
    const store = temporary();
    const bin = temporary();
    const real = executableAt(store, "claude-real");
    const link = join(bin, "claude");
    symlinkSync(real, link);

    // The link's own path, not its target: what a `PATH` gives is what is reported.
    expect(found(await providersIn(lookupOver(bin)), "claude")).toMatchObject({ present: true, path: link });
  });

  it("refuses a dangling symbolic link", async () => {
    const bin = temporary();
    symlinkSync(join(temporary(), "was-here"), join(bin, "codex"));

    expect(found(await providersIn(lookupOver(bin)), "codex").present).toBe(false);
  });

  it("reads a PATH entry the file system refuses as nothing there, not as a failure", async () => {
    const bin = temporary();
    executableAt(bin, "claude");

    // A `PATH` is the environment's: one unusable entry must not cost the answer about the others.
    const providers = await providersIn({
      path: [join(bin, "no-such-directory"), "\u0000", bin].join(":"),
      platform: "linux",
    });

    expect(found(providers, "claude").present).toBe(true);
  });
});

/* -------------------------------------------------------------------------------------------------
 * How the PATH is read
 * ---------------------------------------------------------------------------------------------- */

describe("how the PATH is read", () => {
  it("takes the first entry that has the CLI, the way a shell does", async () => {
    const first = temporary();
    const second = temporary();
    const winner = executableAt(first, "claude");
    executableAt(second, "claude");

    expect(found(await providersIn(lookupOver(first, second)), "claude")).toMatchObject({ path: winner });
    // Reversed, and the other one wins: it is the order and nothing else that decides.
    expect(found(await providersIn(lookupOver(second, first)), "claude")).toMatchObject({
      path: join(second, "claude"),
    });
  });

  it("skips an empty entry and a relative one, and says which paths it would try", () => {
    // Both mean "wherever this process happens to be", which is the thing `pty-agent-runner.ts` refuses
    // by requiring a `cwd`. Proven on the reading, because the answer is what is *not* tried.
    expect(candidatesFor("claude", { path: ":bin:./tools:/opt/bin", platform: "linux" })).toEqual([
      "/opt/bin/claude",
    ]);
  });

  it("tries each entry once", () => {
    expect(candidatesFor("codex", { path: "/a:/b:/a", platform: "linux" })).toEqual([
      "/a/codex",
      "/b/codex",
    ]);
  });

  it("answers nothing for a blank PATH, because there is nowhere to look", () => {
    expect(candidatesFor("claude", { path: "", platform: "linux" })).toEqual([]);
  });

  it("hands the list out frozen", () => {
    expect(Object.isFrozen(candidatesFor("claude", { path: "/a", platform: "linux" }))).toBe(true);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Windows rules, proven where they are pure
 * ---------------------------------------------------------------------------------------------- */

describe("a PATHEXT platform", () => {
  const windows = (path: string, pathext?: string): ProviderLookup =>
    pathext === undefined ? { path, platform: "win32" } : { path, platform: "win32", pathext };

  it("splits on the semicolon and expands PATHEXT in its own order, per directory", () => {
    expect(candidatesFor("claude", windows("C:\\bin;D:\\tools", ".COM;.EXE;.CMD"))).toEqual([
      "C:\\bin\\claude.COM",
      "C:\\bin\\claude.EXE",
      "C:\\bin\\claude.CMD",
      "D:\\tools\\claude.COM",
      "D:\\tools\\claude.EXE",
      "D:\\tools\\claude.CMD",
    ]);
  });

  it("strips the quotes a Windows PATH puts around an entry with a space in it", () => {
    // Left on, the quote makes the entry non-absolute and the whole directory disappears silently —
    // the direction of error this repository refuses: over-reporting costs a `stat`, under-reporting
    // tells a human to install what they already have.
    expect(candidatesFor("gemini", windows('"C:\\Program Files\\bin"', ".EXE"))).toEqual([
      "C:\\Program Files\\bin\\gemini.EXE",
    ]);
  });

  it("takes a name that already carries a PATHEXT extension as it is", () => {
    expect(candidatesFor("claude.cmd", windows("C:\\bin", ".EXE;.CMD"))).toEqual(["C:\\bin\\claude.cmd"]);
    // Case-insensitively, because Windows is.
    expect(candidatesFor("claude.CMD", windows("C:\\bin", ".exe;.cmd"))).toEqual(["C:\\bin\\claude.CMD"]);
  });

  it("does not look for an extensionless file, which Windows cannot start", () => {
    expect(candidatesFor("claude", windows("C:\\bin", ".EXE"))).toEqual(["C:\\bin\\claude.EXE"]);
  });

  it("falls back to what cmd.exe falls back to when PATHEXT is absent or blank", () => {
    const expected = ["C:\\bin\\codex.COM", "C:\\bin\\codex.EXE", "C:\\bin\\codex.BAT", "C:\\bin\\codex.CMD"];
    expect(candidatesFor("codex", windows("C:\\bin"))).toEqual(expected);
    expect(candidatesFor("codex", windows("C:\\bin", "   "))).toEqual(expected);
  });

  it("drops an empty PATHEXT entry and keeps every other verbatim", () => {
    expect(candidatesFor("codex", windows("C:\\bin", ".EXE;;.cmd"))).toEqual([
      "C:\\bin\\codex.EXE",
      "C:\\bin\\codex.cmd",
    ]);
  });

  it("ignores PATHEXT everywhere else", () => {
    expect(candidatesFor("codex", { path: "/usr/bin", platform: "darwin", pathext: ".EXE" })).toEqual([
      "/usr/bin/codex",
    ]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * The real machine
 * ---------------------------------------------------------------------------------------------- */

describe("the real machine PATH", () => {
  /** What a shell answers for the same question, or `undefined` when it finds nothing. */
  function whichSaysAbout(cli: string): string | undefined {
    const asked = spawnSync("sh", ["-c", `command -v ${cli}`], { encoding: "utf8" });
    const said = asked.stdout.trim();
    return asked.status === 0 && said.length > 0 ? said : undefined;
  }

  it("reads PATH and PATHEXT off this process, and nothing else", () => {
    const lookup = hostLookup();

    expect(lookup.path).toBe(process.env.PATH ?? "");
    expect(lookup.platform).toBe(process.platform);
    expect(lookup.pathext).toBe(process.env.PATHEXT);
    // A hand-built world is what makes this function's default worth having rather than a hidden read.
    expect(hostLookup({ PATH: "/nowhere" }, "linux")).toEqual({
      path: "/nowhere",
      platform: "linux",
      pathext: undefined,
    });
    expect(hostLookup({}, "linux").path).toBe("");
  });

  it("agrees with the shell about every provider, on this machine", async () => {
    if (process.platform === "win32") {
      // `sh` is the oracle and there is none here. The Windows file-system half is a declared Gap.
      return;
    }

    // The oracle resolves a relative `PATH` entry against its own working directory and this module
    // skips one, so the comparison is only meaningful over a `PATH` that has none. Every machine this
    // has run on has none, and if one appears the message says so rather than the test failing obscurely.
    const relative = (process.env.PATH ?? "")
      .split(":")
      .filter((piece) => piece.length > 0 && !piece.startsWith("/"));
    expect(relative, "the host PATH has a relative entry, so the shell is not a comparable oracle").toEqual([]);

    const providers = await providersIn(hostLookup());
    const mine = providers.map((provider) => `${provider.id} -> ${provider.present ? provider.path : "absent"}`);
    const shell = providers.map(
      (provider) => `${provider.id} -> ${whichSaysAbout(provider.cli) ?? "absent"}`,
    );

    expect(mine).toEqual(shell);
    // Vacuity guard: an agreement over three providers none of which exists proves nothing about
    // finding one. This machine has `claude` and not `codex` or `gemini`; a machine with none of the
    // three would make the comparison above empty of content, so it is said out loud here.
    expect(shell.some((line) => !line.endsWith("absent"))).toBe(true);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Refusals
 * ---------------------------------------------------------------------------------------------- */

describe("a lookup that cannot be made", () => {
  it("refuses a PATH that is not a string, rather than reporting nothing installed", async () => {
    const lost = { platform: "linux", path: undefined } as unknown as ProviderLookup;

    await expect(providersIn(lost)).rejects.toBeInstanceOf(InvalidProviderLookupError);
    await expect(providersIn(lost)).rejects.toThrow("must be a string, received undefined");
    expect(() => candidatesFor("claude", lost)).toThrow(InvalidProviderLookupError);
  });

  it("refuses a platform that is not a string", async () => {
    const lost = { path: "/usr/bin", platform: 42 } as unknown as ProviderLookup;

    await expect(providersIn(lost)).rejects.toThrow(InvalidProviderLookupError);
    await expect(providersIn(lost)).rejects.toThrow("names the platform whose rules apply, received 42");
  });

  it("refuses a PATHEXT that is not a string when one is given", () => {
    const lost = { path: "C:\\bin", platform: "win32", pathext: 7 } as unknown as ProviderLookup;

    expect(() => candidatesFor("claude", lost)).toThrow(InvalidProviderLookupError);
    expect(() => candidatesFor("claude", lost)).toThrow("PATHEXT must be a string when it is given");
  });

  it("reads any other platform as POSIX rather than refusing it", () => {
    expect(candidatesFor("claude", { path: "/bin", platform: "haiku" })).toEqual(["/bin/claude"]);
  });
});

describe("a Catalog that cannot be offered", () => {
  /** The violations of one refused Catalog, or a failure if it was accepted. */
  async function refusalOver(catalog: readonly unknown[]): Promise<readonly string[]> {
    try {
      await providersIn({ path: "", platform: "linux", catalog: catalog as readonly ProviderCatalogEntry[] });
    } catch (cause) {
      expect(cause).toBeInstanceOf(InvalidProviderCatalogError);
      if (cause instanceof InvalidProviderCatalogError) {
        return cause.violations;
      }
    }
    throw new Error("this Catalog was offered and should not have been");
  }

  it("refuses a Catalog default that is not a runnable Harness, naming the provider", async () => {
    // No cast needed: `model: ""` satisfies the type and `harness()` is what refuses it. This is the
    // whole reason the default goes through `harness()` rather than being trusted for being typed.
    expect(await refusalOver([entry({ model: "" })])).toEqual([
      'provider 0 carries a Catalog default that is not runnable — Harness is not runnable: model must name something, received ""',
    ]);

    expect(await refusalOver([entry({ effort: "thorough" as never })])).toEqual([
      "provider 0 carries a Catalog default that is not runnable — Harness is not runnable: " +
        "effort must be one of min, low, medium, high, max, received \"thorough\"",
    ]);

    expect(await refusalOver([entry({ skills: ["review", "review"] })])).toEqual([
      "provider 0 carries a Catalog default that is not runnable — Harness is not runnable: " +
        "skills must list each Skill once, received review twice",
    ]);
  });

  it("reports every violation at once, the way harness() reports a bundle's", async () => {
    // A Catalog of seven entries wrong in three ways should not be discovered one run at a time.
    expect(await refusalOver([entry({ id: "" }), entry({ id: "b", cli: "b", model: "" }), 7])).toEqual([
      'provider 0\'s id must name something, received ""',
      "provider 1 carries a Catalog default that is not runnable — Harness is not runnable: " +
        'model must name something, received ""',
      "provider 2 is 7, not a provider",
    ]);
  });

  it("refuses a cli that is not a bare program name", async () => {
    expect(await refusalOver([entry({ cli: "  " })])).toEqual([
      'provider 0\'s cli must name something, received "  "',
    ]);
    expect(await refusalOver([entry({ cli: "/usr/local/bin/claude" })])).toEqual([
      'provider 0\'s cli is "/usr/local/bin/claude", which carries a directory separator: ' +
        "a PATH lookup takes a bare program name",
    ]);
    expect(await refusalOver([entry({ cli: "bin\\claude" })])).toEqual([
      'provider 0\'s cli is "bin\\\\claude", which carries a directory separator: ' +
        "a PATH lookup takes a bare program name",
    ]);
    expect(await refusalOver([entry({ cli: "cla\u0000ude" })])).toEqual([
      'provider 0\'s cli is "cla\\u0000ude", which carries a NUL: no file can be named that',
    ]);
  });

  it("refuses two providers under one id, and two defaults for one CLI", async () => {
    expect(await refusalOver([entry({ id: "claude", cli: "a" }), entry({ id: "claude", cli: "b" })])).toEqual([
      'provider 1 repeats the id "claude": two providers cannot answer to one name',
    ]);
    expect(await refusalOver([entry({ id: "a", cli: "claude" }), entry({ id: "b", cli: "claude" })])).toEqual([
      'provider 1 repeats the cli "claude": a Catalog holds one default per CLI',
    ]);
  });

  it("refuses a Catalog that is not a list of providers", async () => {
    expect(await refusalOver({ claude: entry() } as unknown as readonly unknown[])).toEqual([
      "a Catalog is a list of providers, received an object",
    ]);
    expect(await refusalOver([null])).toEqual(["provider 0 is null, not a provider"]);
    expect(await refusalOver([["claude"]])).toEqual(["provider 0 is a list, not a provider"]);
  });

  it("refuses the Catalog before it touches a disk", async () => {
    const bin = temporary();
    executableAt(bin, "fake-cli");

    // The fixture would have been found; the Catalog is decided first, so nothing was looked at.
    await expect(
      providersIn({ ...lookupOver(bin), catalog: [entry({ model: "" })] }),
    ).rejects.toBeInstanceOf(InvalidProviderCatalogError);
  });
});

/* -------------------------------------------------------------------------------------------------
 * The type level
 * ---------------------------------------------------------------------------------------------- */

describe("the type level", () => {
  const anywhere: ProviderLookup = { path: "", platform: "linux" };

  it("keeps the path on the member that has one", async () => {
    const providers = await providersIn(anywhere);
    const provider = found(providers, "claude");

    // @ts-expect-error — `path` is unreadable off the un-narrowed union, because the absent member does
    // not declare it: a reader must ask whether the provider is present before it can name a path.
    const unasked: unknown = provider.path;

    const absent: AbsentProvider = { present: false, id: "x", name: "X", cli: "x", catalogDefault: provider.catalogDefault };
    const forced: Provider = {
      ...absent,
      // @ts-expect-error — an absent provider carries no path: "not installed, at /usr/bin/x" is not a
      // state this module can answer, so it is not a value anybody can build either.
      path: "/usr/bin/x",
    };

    expect([unasked, forced.present]).toEqual([undefined, false]);
  });

  it("answers a plain string once the provider is known to be present", async () => {
    const provider = found(await providersIn(anywhere), "claude");

    if (provider.present) {
      // Not expressible as a `@ts-expect-error`: the claim is assignability, so the proof is the
      // annotation. Widen `path` to `string | undefined` and this line stops compiling.
      const at: string = provider.path;
      expect(typeof at).toBe("string");
    }
    expect(provider.present).toBe(false);
  });

  it("answers only the present ones from presentIn, not the union", async () => {
    // Same shape of proof, and the reason the reading exists: what the Cockpit offers per Pane is a list
    // of providers that each have a path.
    const offered: readonly PresentProvider[] = presentIn(await providersIn(anywhere));

    expect(offered).toEqual([]);
  });

  it("hands out readings, not handles", async () => {
    const provider = found(await providersIn(anywhere), "codex");

    const providers = await providersIn(anywhere);

    // Each probe pairs the type claim with the runtime half, because a frozen object is what actually
    // stops a write that arrived through a cast.
    expect(() => {
      // @ts-expect-error — a Provider is a reading of a `PATH` at a moment; nothing about it is settable.
      provider.name = "Codex, renamed";
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error — and the answer is a list nobody may append a provider to.
      providers.push(provider);
    }).toThrow(TypeError);

    expect(provider.name).toBe("Codex");
  });

  it("requires the whole lookup, because nothing about the world is assumed", async () => {
    // @ts-expect-error — the PATH is never read from process.env on this module's own initiative.
    const noPath = (): Promise<readonly Provider[]> => providersIn({ platform: "linux" });
    // @ts-expect-error — the platform is an input too: it is what makes the Windows rules provable here.
    const noPlatform = (): Promise<readonly Provider[]> => providersIn({ path: "/usr/bin" });
    const unknownField = (): Promise<readonly Provider[]> =>
      providersIn({
        ...anywhere,
        // @ts-expect-error — there is no `cwd` to resolve a relative PATH entry against, deliberately:
        // an option only a test would pass is the always-zero field wearing a different type.
        cwd: "/tmp",
      });

    expect([noPath, noPlatform, unknownField].every((asked) => typeof asked === "function")).toBe(true);
    await expect(providersIn(anywhere)).resolves.toHaveLength(3);
  });

  it("requires a Catalog entry to carry every field of a default", () => {
    // @ts-expect-error — no model: it would resolve to a Harness with no model, which `harness()` would
    // then refuse at detection time instead of the compiler refusing it here.
    const modelless: ProviderCatalogEntry = { id: "x", name: "X", cli: "x", effort: "medium", skills: [] };
    const carrying: ProviderCatalogEntry = {
      ...entry(),
      // @ts-expect-error — an entry carries the *fields* of a default and never a Harness: two places to
      // write `cli` down is one place for them to disagree.
      catalogDefault: { cli: "x", model: "m", effort: "medium", skills: [] },
    };

    expect([modelless.id, carrying.id]).toEqual(["x", "fake"]);
  });

  it("keeps the Catalog's entries literal while checking their shape", () => {
    // `as const satisfies` and not an annotation: an annotation widens `id` to `string`, and this line
    // is what proves the literals survived. A regression here is not cosmetic — the ids are what a
    // protocol frame or a Command names a provider with.
    const claude: "claude" = PROVIDER_CATALOG[0].id;
    const efforts: readonly "medium"[] = PROVIDER_CATALOG.map((known) => known.effort);

    expect([claude, efforts.length]).toEqual(["claude", 3]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Nothing left behind
 * ---------------------------------------------------------------------------------------------- */

describe("the fixtures", () => {
  it("all live under the temporary directory and nowhere near the Workspace", () => {
    expect(created.length).toBeGreaterThan(0);
    for (const made of created) {
      expect(made.startsWith(tmpdir())).toBe(true);
      expect(made.includes("megazord-providers-")).toBe(true);
    }
  });
});
