import { RepoContext } from "./context.js";
import { badInput } from "./errors.js";
import { mintEvent } from "./events.js";
import { moveId, seedId } from "./ids.js";
import { reserveNumber } from "./events.js";
import { ObjectFile, tryReadObject, writeObject } from "./objects.js";
import { parseCommitMessage, getTrailer } from "./trailers.js";
import { commitEvent } from "./metaops.js";
import { materializeStream } from "./materialize.js";
import { createStream, streamExists } from "./streams.js";
import { nowIso } from "./work.js";

export interface AdoptOptions {
  commits?: string[];
  scan?: string;
  stream?: string;
  agent?: string;
}

export interface AdoptResult {
  adopted: { commit: string; id: string; kind: "move" | "seed" }[];
  skipped: string[];
}

interface AdoptUnit {
  commits: string[];
  key: string;
}

export async function adopt(ctx: RepoContext, opts: AdoptOptions): Promise<AdoptResult> {
  const agent = opts.agent ?? "adopt";
  let commits: string[] = [];
  if (opts.commits && opts.commits.length > 0) {
    for (const c of opts.commits) {
      const sha = await ctx.git.tryRevParse(c, ctx.root);
      if (!sha) throw badInput(`cannot resolve commit ${c}`);
      commits.push(sha);
    }
  } else if (opts.scan) {
    const res = await ctx.git.run(["rev-list", "--reverse", opts.scan, "--"], { cwd: ctx.root });
    if (res.exitCode !== 0) throw badInput(`cannot scan ${opts.scan}: ${res.stderr.trim()}`);
    commits = res.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    throw badInput("adopt needs commits or --scan <rev-range>");
  }

  const streamName = opts.stream ?? "main";
  if (!(await streamExists(ctx, streamName))) {
    await createStream(ctx, agent, streamName, { base: "cp/root/0", description: "main" });
  }

  const seedObj = await tryReadObject(ctx, "seed.000001");
  const seedCommit = seedObj?.commit ?? null;

  const units: AdoptUnit[] = [];
  const indexByKey = new Map<string, AdoptUnit>();
  const skipped: string[] = [];
  for (const sha of commits) {
    if (sha === seedCommit) {
      skipped.push(sha);
      continue;
    }
    if (await ctx.readMeta(`adopted/${sha}`)) {
      skipped.push(sha);
      continue;
    }
    const message = await ctx.git.messageOf(sha, ctx.root);
    const parsed = parseCommitMessage(message);
    const changeSet = getTrailer(parsed, "Change-Set-Id");
    const key = changeSet ? `cs:${changeSet}` : `c:${sha}`;
    const existing = indexByKey.get(key);
    if (existing) {
      existing.commits.push(sha);
    } else {
      const unit: AdoptUnit = { commits: [sha], key };
      indexByKey.set(key, unit);
      units.push(unit);
    }
  }

  const adopted: AdoptResult["adopted"] = [];
  const newIds: string[] = [];

  for (const unit of units) {
    const first = unit.commits[0];
    const last = unit.commits[unit.commits.length - 1];
    const message = await ctx.git.messageOf(first, ctx.root);
    const parsed = parseCommitMessage(message);

    const diff = await ctx.git.run(
      ["diff", "--name-status", "--find-renames=50%", `${first}^`, last, "--"],
      { cwd: ctx.root },
    );
    const entries = diff.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const allAdded = entries.every((l) => l.startsWith("A"));
    const kind: "move" | "seed" = allAdded ? "seed" : "move";

    let id: string;
    if (kind === "seed") {
      id = seedId(await reserveNumber(ctx, "seed"));
    } else {
      id = moveId(await reserveNumber(ctx, "move"));
    }
    if (await tryReadObject(ctx, id)) throw badInput(`id collision adopting ${first}`);

    let canonical = last;
    if (unit.key.startsWith("cs:") || unit.commits.length > 1) {
      // A legacy Change-Set-Id group is squashed into one commit whose diff runs
      // from the first parent of the first commit to the last commit's tree.
      const parent = await ctx.git.parentOf(first, ctx.root);
      const tree = await ctx.git.treeOf(last, ctx.root);
      const subject = parsed.subject || "(adopted)";
      const trailerKind = kind === "seed" ? "Seed-Id" : "Move-Id";
      const author = await ctx.git.authorOf(first, ctx.root);
      const groupMessage =
        `${subject}\n\n` +
        `${trailerKind}: ${id}\nAgent-Id: ${getTrailer(parsed, "Agent-Id") ?? agent}\n`;
      canonical = await ctx.git.commitTree({
        cwd: ctx.root,
        tree,
        parents: parent ? [parent] : [],
        message: groupMessage,
        author,
        committer: { name: "kawa", email: "kawa@invalid", date: author.date },
      });
    }

    await ctx.git.runOk(["update-ref", `refs/kawa/objects/${id}`, canonical], { cwd: ctx.root });

    const paths = (
      await ctx.git.run(["diff", "--name-only", "--find-renames=50%", `${first}^`, last, "--"], {
        cwd: ctx.root,
      })
    ).stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const author = await ctx.git.authorOf(first, ctx.root);
    const parent = await ctx.git.parentOf(first, ctx.root);
    const obj: ObjectFile = {
      id,
      kind,
      ref_ids:
        unit.commits
          .map((c) => c)
          .length > 0
          ? parseAllRefIds(parseCommitMessage(await ctx.git.messageOf(last, ctx.root)))
          : [],
      group: null,
      agent_or_session: getTrailer(parsed, "Agent-Id") ?? agent,
      author: author.name,
      description: parsed.subject || "(adopted)",
      checkout_description: null,
      checkin_description: null,
      base_sha: parent ?? "",
      commit: canonical,
      request_key: null,
      paths,
      created_at: author.date,
      renames: [],
      depends_on: [],
      demands: [],
      resolves: null,
      supersedes: null,
      derived_from: null,
      file_ids: Object.fromEntries(paths.map((p) => [p, `${id}:${p}`])),
      legacy_alias: `legacy-${first.slice(0, 7)}`,
      adopted_from: first,
      signature: null,
    };
    await writeObject(ctx, obj);
    ctx.writeMetaFile(
      `adopted/${first}`,
      JSON.stringify({ move: id, commit: canonical, adopted_at: nowIso() }, null, 2) + "\n",
    );

    for (const c of unit.commits) {
      ctx.writeMetaFile(
        `adopted/${c}`,
        JSON.stringify({ move: id, commit: canonical, adopted_at: nowIso() }, null, 2) + "\n",
      );
    }
    newIds.push(id);
    adopted.push({ commit: first, id, kind });
  }

  if (newIds.length > 0) {
    const ev = await mintEvent(ctx, agent, streamName, "add", {
      objects: newIds,
      description: "adopt",
    });
    await commitEvent(ctx, ev, agent);
    await materializeStream(ctx, streamName);
  }

  return { adopted, skipped };
}

function parseAllRefIds(parsed: ReturnType<typeof parseCommitMessage>): string[] {
  return parsed.trailers.filter(([k]) => k === "Ref-Id").map(([, v]) => v);
}
