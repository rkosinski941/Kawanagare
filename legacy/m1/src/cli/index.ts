#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { RepoContext } from "../core/context.js";
import { KawaError, EXIT, notImplemented, badInput } from "../core/errors.js";
import { initRepo } from "../core/init.js";
import {
  createStream,
  checkpointStream,
  listStreams,
  showStream,
} from "../core/streams.js";
import {
  checkout,
  checkin,
  addFiles,
  cancel,
  resume,
  listStale,
  readState,
  nowIso,
} from "../core/work.js";
import {
  carry,
  merge,
  backout,
  restore,
  splitMove,
  listObjects,
  showObject,
} from "../core/ops.js";
import { adopt } from "../core/adopt.js";
import { materializeStream } from "../core/materialize.js";

const program = new Command();
program
  .name("kawa")
  .description("KawaNagare: streams, moves and seeds on git")
  .version("0.1.0-m1")
  .showHelpAfterError();

function nextStepFor(code: number): string | undefined {
  switch (code) {
    case EXIT.CONFLICT:
      return "resolve the conflict, then retry; run with --dry-run to preview";
    case EXIT.DEP_REFUSAL:
      return "include the dependent objects, or re-point them";
    case EXIT.STALE_BASE:
      return "fix the conflict and run `kawa checkin --rebase`";
    case EXIT.LOCK_TIMEOUT:
      return "wait for the other kawa command to finish, then retry";
    case EXIT.NEEDS_APPROVAL:
      return "ask Rich to approve the request";
    default:
      return undefined;
  }
}

async function handle(json: boolean, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err: any) {
    const isKawa = err instanceof KawaError;
    const code = isKawa ? err.code : 5_00;
    const exitCode = isKawa ? err.exitCode : EXIT.BAD_INPUT;
    const message = err?.message ?? String(err);
    const next_step = nextStepFor(exitCode);
    if (json) {
      console.log(
        JSON.stringify({
          ok: false,
          error: isKawa ? errorName(exitCode) : "error",
          code,
          message,
          next_step,
          ...(isKawa ? err.detail ?? {} : {}),
        }),
      );
    } else {
      console.error(message);
      if (next_step) console.error(`Next: ${next_step}`);
    }
    process.exitCode = exitCode;
  }
}

function errorName(exitCode: number): string {
  switch (exitCode) {
    case EXIT.CONFLICT:
      return "conflict";
    case EXIT.DEP_REFUSAL:
      return "dependency_refusal";
    case EXIT.STALE_BASE:
      return "stale_base";
    case EXIT.LOCK_TIMEOUT:
      return "lock_timeout";
    case EXIT.NEEDS_APPROVAL:
      return "needs_approval";
    case EXIT.HOOK_FAILED:
      return "hook_failed";
    default:
      return "bad_input";
  }
}

function out(json: boolean, value: unknown, text: string): void {
  if (json) console.log(JSON.stringify(value, null, 2));
  else console.log(text);
}

async function withRepo<T>(fn: (ctx: RepoContext) => Promise<T>): Promise<T> {
  const ctx = await RepoContext.load(process.cwd());
  return await fn(ctx);
}

async function withLockedRepo<T>(
  agent: string | undefined,
  fn: (ctx: RepoContext) => Promise<T>,
): Promise<T> {
  const ctx = await RepoContext.load(process.cwd());
  return await ctx.withLock(agent, () => fn(ctx));
}

function commaList(values: string[] | undefined): string[] {
  if (!values) return [];
  return values.flatMap((v) => v.split(",").map((s) => s.trim()).filter(Boolean));
}

function parseRepoint(values: string[] | undefined): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const v of values ?? []) {
    for (const part of v.split(",")) {
      const [dep, target] = part.split("=");
      if (!dep || !target) throw badInput(`bad --repoint value: ${part}`);
      map[dep.trim()] = target.split("+").map((s) => s.trim());
    }
  }
  return map;
}

// ---- init ----
program
  .command("init")
  .description("turn this repository into a kawa seed and create kawa-meta")
  .option("--adopt-history", "adopt existing history")
  .option("--remote <url>", "remote URL")
  .option("--site <id>", "site id")
  .option("--agent <agent>", "agent id for the seed")
  .option("--json")
  .action(async (opts) =>
    handle(!!opts.json, async () => {
      const result = await initRepo(process.cwd(), {
        adoptHistory: !!opts.adoptHistory,
        remote: opts.remote,
        site: opts.site,
        agent: opts.agent,
      });
      out(
        !!opts.json,
        result,
        `Initialized kawa at ${result.root} (site ${result.siteId}).\n` +
          `Created ${result.seedId} and checkpoint ${result.checkpoint}.`,
      );
    }),
  );

// ---- stream ----
const stream = program.command("stream").description("create and inspect streams");

stream
  .command("create <name>")
  .option("--base <checkpoint>", "base checkpoint, e.g. cp/root/0")
  .option("--from <stream>", "fork from a stream")
  .option("--checkpoint <n>", "checkpoint number to fork from")
  .option("--description <text>")
  .option("--agent <agent>", "agent id", "enjoy")
  .option("--json")
  .action(async (name, opts) =>
    handle(!!opts.json, async () =>
      withLockedRepo(opts.agent, async (ctx) => {
        const recipe = await createStream(ctx, opts.agent, name, {
          base: opts.base,
          forkFrom: opts.from
            ? {
                stream: opts.from,
                checkpoint: opts.checkpoint !== undefined ? Number(opts.checkpoint) : undefined,
              }
            : undefined,
          description: opts.description,
        });
        out(!!opts.json, { name, base: recipe.base }, `Created stream ${name} from ${recipe.base}`);
      }),
    ),
  );

stream
  .command("fork <name>")
  .requiredOption("--from <stream>")
  .option("--checkpoint <n>", "checkpoint number to fork from")
  .option("--description <text>")
  .option("--agent <agent>", "agent id", "enjoy")
  .option("--json")
  .action(async (name, opts) =>
    handle(!!opts.json, async () =>
      withLockedRepo(opts.agent, async (ctx) => {
        const recipe = await createStream(ctx, opts.agent, name, {
          forkFrom: {
            stream: opts.from,
            checkpoint: opts.checkpoint !== undefined ? Number(opts.checkpoint) : undefined,
          },
          description: opts.description,
        });
        out(!!opts.json, { name, base: recipe.base }, `Forked ${name} from ${recipe.base}`);
      }),
    ),
  );

stream
  .command("list")
  .option("--json")
  .action(async (opts) =>
    handle(!!opts.json, async () =>
      withRepo(async (ctx) => {
        const names = await listStreams(ctx);
        out(!!opts.json, names, names.length ? names.join("\n") : "(no streams)");
      }),
    ),
  );

stream
  .command("show <name>")
  .option("--json")
  .action(async (name, opts) =>
    handle(!!opts.json, async () =>
      withRepo(async (ctx) => {
        const recipe = await showStream(ctx, name);
        if (opts.json) {
          console.log(JSON.stringify(recipe, null, 2));
        } else {
          console.log(`Stream: ${recipe.name}`);
          console.log(`Base: ${recipe.base}`);
          if (recipe.forked_from)
            console.log(`Forked from: ${recipe.forked_from.stream} at ${recipe.forked_from.checkpoint}`);
          console.log(`Objects (${recipe.objects.length}):`);
          for (const o of recipe.objects) {
            const mark = o.in_play ? " " : "x";
            console.log(`  [${mark}] ${o.id}${o.backed_out_by ? ` (backed out by ${o.backed_out_by})` : ""}`);
          }
        }
      }),
    ),
  );

// ---- checkpoint ----
program
  .command("checkpoint <stream>")
  .option("-m, --message <text>")
  .option("--agent <agent>", "agent id", "enjoy")
  .option("--json")
  .action(async (name, opts) =>
    handle(!!opts.json, async () =>
      withLockedRepo(opts.agent, async (ctx) => {
        const result = await checkpointStream(ctx, opts.agent, name, opts.message);
        out(
          !!opts.json,
          { tag: result.tag, n: result.n, head: result.head, contains: result.record.contains },
          `Created ${result.tag} (${result.record.contains.length} objects).`,
        );
      }),
    ),
  );

// ---- checkout ----
program
  .command("checkout")
  .option("--stream <name>")
  .option("-m, --message <text>", "checkout description")
  .option("--ref <id>", "reference id", collect, [])
  .option("--agent <agent>", "agent id", "enjoy")
  .option("--resume <id>", "resume a cancelled work area")
  .option("--list-stale", "list work areas idle more than 24h")
  .option("--json")
  .action(async (opts) =>
    handle(!!opts.json, async () => {
      if (opts.listStale) {
        return withRepo(async (ctx) => {
          const stale = await listStale(ctx);
          if (opts.json) console.log(JSON.stringify(stale, null, 2));
          else if (stale.length === 0) console.log("No stale work areas.");
          else for (const s of stale) console.log(`${s.id}  ${s.stream}  ${s.agent}  ${s.worktree}`);
        });
      }
      if (opts.resume) {
        return withLockedRepo(opts.agent, async (ctx) => {
          const result = await resume(ctx, opts.resume);
          out(
            !!opts.json,
            result,
            `Resumed ${result.id} in ${result.worktree} on ${result.work_branch}.`,
          );
        });
      }
      if (!opts.stream) throw badInput("checkout needs --stream");
      return withLockedRepo(opts.agent, async (ctx) => {
        const result = await checkout(ctx, {
          stream: opts.stream,
          description: opts.message,
          refIds: commaList(opts.ref),
          agent: opts.agent,
        });
        out(
          !!opts.json,
          result,
          `Checked out ${result.id} from ${result.stream}.\nWork area: ${result.worktree}\nBranch: ${result.work_branch}`,
        );
      });
    }),
  );

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

// ---- checkin ----
program
  .command("checkin")
  .option("-m, --message <text>", "checkin description")
  .option("--split", "split new files into a seed plus a move")
  .option("--no-split", "keep additions and edits in one move")
  .option("--paths <files...>", "check in only these paths")
  .option("--depends-on <ids...>", "record dependencies")
  .option("--rebase", "finish a check-in that hit a stale base")
  .option("--keep", "keep the work area after check-in")
  .option("--id <id>", "work area id")
  .option("--idempotency-key <key>")
  .option("--agent <agent>", "agent id")
  .option("--json")
  .action(async (opts) =>
    handle(!!opts.json, async () =>
      withLockedRepo(opts.agent, async (ctx) => {
        const result = await checkin(ctx, {
          id: opts.id,
          cwd: process.cwd(),
          description: opts.message,
          split: opts.split === true,
          noSplit: opts.split === false,
          paths: opts.paths,
          dependsOn: opts.dependsOn,
          rebase: !!opts.rebase,
          keep: !!opts.keep,
          requestKey: opts.idempotencyKey ?? process.env.KAWA_IDEMPOTENCY_KEY,
          agent: opts.agent,
          JSON: !!opts.json,
        });
        const id = result.ids[result.kind === "split" ? 1 : 0] ?? result.ids[0];
        out(
          !!opts.json,
          result,
          result.kind === "split"
            ? `Checked in ${result.ids.join(" and ")} (seed then move).`
            : `Checked in ${id} (${result.kind}).`,
        );
      }),
    ),
  );

// ---- add ----
program
  .command("add <files...>")
  .requiredOption("--stream <name>")
  .requiredOption("-m, --message <text>")
  .option("--agent <agent>", "agent id", "enjoy")
  .option("--json")
  .action(async (files, opts) =>
    handle(!!opts.json, async () =>
      withLockedRepo(opts.agent, async (ctx) => {
        const result = await addFiles(ctx, {
          files,
          stream: opts.stream,
          description: opts.message,
          agent: opts.agent,
        });
        out(!!opts.json, result, `Added ${result.ids[0]} (seed).`);
      }),
    ),
  );

// ---- move ----
const move = program.command("move").description("inspect and split moves");

move
  .command("list")
  .option("--stream <name>")
  .option("--kind <kind>")
  .option("--backed-out", "list backed-out objects")
  .option("--limbo")
  .option("--signed-as <site>")
  .option("--agent <agent>")
  .option("--json")
  .action(async (opts) =>
    handle(!!opts.json, async () =>
      withRepo(async (ctx) => {
        const rows = await listObjects(ctx, {
          stream: opts.stream,
          kind: opts.kind === "seed" || opts.kind === "move" ? opts.kind : undefined,
          backedOut: !!opts.backedOut,
          agent: opts.agent,
        });
        if (opts.json) console.log(JSON.stringify(rows, null, 2));
        else if (rows.length === 0) console.log("(no objects)");
        else for (const r of rows) console.log(`${r.id}  ${r.kind}  ${r.agent}  ${r.description}`);
      }),
    ),
  );

move
  .command("show <id>")
  .option("--patch", "also show the commit patch")
  .option("--json")
  .action(async (id, opts) =>
    handle(!!opts.json, async () =>
      withRepo(async (ctx) => {
        const obj = await showObject(ctx, id);
        if (opts.json) {
          console.log(JSON.stringify(obj, null, 2));
        } else {
          console.log(`Id: ${obj.id}`);
          console.log(`Kind: ${obj.kind}`);
          console.log(`Agent: ${obj.agent_or_session}`);
          console.log(`Description: ${obj.description}`);
          console.log(`Commit: ${obj.commit}`);
          console.log(`Paths: ${obj.paths.join(", ")}`);
          if (obj.depends_on.length) console.log(`Depends on: ${obj.depends_on.join(", ")}`);
        }
        if (opts.patch) {
          const res = await ctx.git.run(["show", "--patch", "--stat", obj.commit], { cwd: ctx.root });
          console.log(res.stdout);
        }
      }),
    ),
  );

move
  .command("split <id>")
  .requiredOption("--paths <files...>")
  .option("--stream <name>")
  .option("--repoint <dep=ids...>", "re-point dependents", collect, [])
  .option("--agent <agent>", "agent id", "enjoy")
  .option("--json")
  .action(async (id, opts) =>
    handle(!!opts.json, async () =>
      withLockedRepo(opts.agent, async (ctx) => {
        const result = await splitMove(ctx, {
          id,
          paths: opts.paths,
          stream: opts.stream,
          repoint: parseRepoint(opts.repoint),
          agent: opts.agent,
        });
        out(
          !!opts.json,
          result,
          `Split ${result.old} into ${result.new.join(" and ")} (${result.supersede_event}).`,
        );
      }),
    ),
  );

move
  .command("rebase <id>")
  .requiredOption("--onto <stream>")
  .action(async () => {
    throw notImplemented("kawa move rebase");
  });

move
  .command("diff <a> <b>")
  .action(async () => {
    throw notImplemented("kawa move diff");
  });

// ---- adopt ----
program
  .command("adopt [commits...]")
  .option("--scan <range>", "scan a revision range")
  .option("--stream <name>", "stream to append to", "main")
  .option("--agent <agent>", "agent id", "adopt")
  .option("--json")
  .action(async (commits, opts) =>
    handle(!!opts.json, async () =>
      withLockedRepo(opts.agent, async (ctx) => {
        const result = await adopt(ctx, {
          commits,
          scan: opts.scan,
          stream: opts.stream,
          agent: opts.agent,
        });
        out(
          !!opts.json,
          result,
          result.adopted.length === 0
            ? "Nothing to adopt."
            : result.adopted.map((a) => `${a.id} <- ${a.commit.slice(0, 7)} (${a.kind})`).join("\n"),
        );
      }),
    ),
  );

// ---- carry ----
program
  .command("carry <ids...>")
  .requiredOption("--from <stream>")
  .requiredOption("--to <stream>")
  .option("--group <name>")
  .option("--dry-run")
  .option("--with-deps")
  .option("--keep-pending")
  .option("--keep")
  .option("--agent <agent>", "agent id", "enjoy")
  .option("--json")
  .action(async (ids, opts) =>
    handle(!!opts.json, async () =>
      withLockedRepo(opts.agent, async (ctx) => {
        const result = await carry(ctx, {
          ids,
          from: opts.from,
          to: opts.to,
          group: opts.group,
          dryRun: !!opts.dryRun,
          withDeps: !!opts.withDeps,
          keepPending: !!opts.keepPending,
          agent: opts.agent,
        });
        const text =
          (result.dry_run ? "Dry run: " : "") +
          (result.added.length
            ? `carried ${result.added.join(", ")} into ${opts.to}`
            : `nothing to carry into ${opts.to}`) +
          (result.warnings.length ? `\nWarnings:\n${result.warnings.join("\n")}` : "");
        out(!!opts.json, result, text);
      }),
    ),
  );

// ---- merge ----
program
  .command("merge <from> <to>")
  .option("--group <name>")
  .option("--dry-run")
  .option("--include-backed-out")
  .option("--keep")
  .option("--agent <agent>", "agent id", "enjoy")
  .option("--json")
  .action(async (from, to, opts) =>
    handle(!!opts.json, async () =>
      withLockedRepo(opts.agent, async (ctx) => {
        const result = await merge(ctx, {
          from,
          to,
          includeBackedOut: !!opts.includeBackedOut,
          dryRun: !!opts.dryRun,
          agent: opts.agent,
        });
        const text =
          (result.dry_run ? "Dry run: " : "") +
          `added ${result.added.length} object(s)` +
          (result.skipped_backed_out.length
            ? `; skipped_backed_out: ${result.skipped_backed_out.join(", ")}`
            : "");
        out(!!opts.json, result, text);
      }),
    ),
  );

// ---- backout / restore ----
program
  .command("backout <stream> <ids...>")
  .option("--group <name>")
  .option("--reason <text>")
  .option("--yes")
  .option("--force")
  .option("--dry-run")
  .option("--keep")
  .option("--agent <agent>", "agent id", "enjoy")
  .option("--json")
  .action(async (streamName, ids, opts) =>
    handle(!!opts.json, async () =>
      withLockedRepo(opts.agent, async (ctx) => {
        const result = await backout(ctx, {
          stream: streamName,
          ids,
          reason: opts.reason,
          dryRun: !!opts.dryRun,
          force: !!opts.force,
          yes: !!opts.yes,
          group: opts.group,
          agent: opts.agent,
        });
        out(
          !!opts.json,
          result,
          (result.dry_run ? "Dry run: " : "") + `backed out ${result.backed_out.join(", ")}`,
        );
      }),
    ),
  );

program
  .command("restore <stream> <ids...>")
  .option("--keep")
  .option("--agent <agent>", "agent id", "enjoy")
  .option("--json")
  .action(async (streamName, ids, opts) =>
    handle(!!opts.json, async () =>
      withLockedRepo(opts.agent, async (ctx) => {
        const result = await restore(ctx, { stream: streamName, ids, agent: opts.agent });
        out(!!opts.json, result, `restored ${result.restored.join(", ")}`);
      }),
    ),
  );

// ---- materialize ----
program
  .command("materialize <stream>")
  .option("--agent <agent>", "agent id", "enjoy")
  .option("--json")
  .action(async (name, opts) =>
    handle(!!opts.json, async () =>
      withLockedRepo(opts.agent, async (ctx) => {
        const result = await materializeStream(ctx, name);
        out(
          !!opts.json,
          result,
          result.skipped
            ? `${name} is up to date at ${result.head}.`
            : `Materialized ${name} at ${result.head} (${result.replayed.length} replayed).`,
        );
      }),
    ),
  );

// ---- cancel ----
program
  .command("cancel <id>")
  .option("--agent <agent>", "agent id", "enjoy")
  .option("--json")
  .action(async (id, opts) =>
    handle(!!opts.json, async () =>
      withLockedRepo(opts.agent, async (ctx) => {
        const result = await cancel(ctx, id, opts.agent);
        out(!!opts.json, result, `Cancelled ${id}; recoverable at ${result.cancelled_ref}.`);
      }),
    ),
  );

// ---- doctor ----
program
  .command("doctor")
  .option("--json")
  .action(async (opts) =>
    handle(!!opts.json, async () =>
      withRepo(async (ctx) => {
        const streams = await listStreams(ctx);
        const problems: string[] = [];
        for (const s of streams) {
          try {
            await showStream(ctx, s);
          } catch (e: any) {
            problems.push(`${s}: ${e.message}`);
          }
        }
        if (opts.json) console.log(JSON.stringify({ ok: problems.length === 0, problems }));
        else if (problems.length === 0) console.log("kawa doctor: no problems found.");
        else problems.forEach((p) => console.error(p));
        if (problems.length > 0) process.exitCode = EXIT.BAD_INPUT;
      }),
    ),
  );

// ---- M2+ stubs ----
const stubs: [string, string][] = [
  ["approve", "kawa approve"],
  ["purge", "kawa purge"],
  ["resolve", "kawa resolve"],
  ["deps", "kawa deps"],
  ["impact", "kawa impact"],
  ["heat", "kawa heat"],
  ["claim", "kawa claim"],
  ["site", "kawa site"],
  ["serve", "kawa serve"],
  ["queue", "kawa queue"],
  ["bundle", "kawa bundle"],
  ["verify", "kawa verify"],
  ["push", "kawa push"],
];
for (const [name, label] of stubs) {
  program
    .command(`${name} [args...]`)
    .description("reserved for a later milestone")
    .allowUnknownOption(true)
    .action(async () => {
      throw notImplemented(label);
    });
}
program
  .command("cache [args...]")
  .description("reserved for a later milestone")
  .allowUnknownOption(true)
  .action(async () => {
    throw notImplemented("kawa cache");
  });

program.parseAsync(process.argv).catch((err: any) => {
  const code = err instanceof KawaError ? err.exitCode : EXIT.BAD_INPUT;
  console.error(err?.message ?? String(err));
  process.exitCode = code;
});
