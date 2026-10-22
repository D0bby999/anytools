#!/usr/bin/env node
/**
 * scripts/methods/videos.mjs
 * The videos the learning-methods guide shows (the private design notes; research in the private design notes).
 *
 * The list below was chosen by hand from YouTube searches: short explainers
 * by the researchers or by channels that cite them, and the most watched
 * explainers in Vietnamese, Spanish and Portuguese. This script reads each
 * video's title, channel, length, date and spoken language with yt-dlp,
 * refuses one that is private, removed or not embeddable, and writes
 * app/data/methods/videos.json. Only metadata is kept; the video plays in
 * YouTube's own privacy-enhanced player.
 *
 *   node scripts/methods/videos.mjs
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../app/data/methods/videos.json");

/** [id, the guide's language for it, methods it explains]. "overview" is the guide's front page. */
export const CHOSEN = [
  ["p60rN9JEapg", "en", ["overview"]],
  ["0NIXM74NwXs", "en", ["overview", "judge"]],
  ["0hJlVqNrnIo", "vi", ["overview"]],
  ["3gGVgdXoWLM", "vi", ["overview"]],
  ["noNv_rTwwNw", "es", ["overview"]],
  ["jBbeUc6A8y4", "es", ["overview"]],
  ["posTc56basM", "pt", ["overview"]],
  ["KzahejCdXys", "pt", ["overview"]],

  ["Pjrqc6UMDKM", "en", ["retrieval"]],
  ["jfREWvtd_DM", "en", ["retrieval"]],
  ["gaHK7zJ50BI", "vi", ["retrieval"]],
  ["UAcGGxi2WqM", "vi", ["retrieval", "spacing"]],
  ["QD-zwXc3dtQ", "es", ["retrieval"]],
  ["riw1rl5z0kM", "pt", ["retrieval"]],
  ["ss382Iqnws8", "pt", ["retrieval"]],

  ["3WJYp98eys8", "en", ["spacing"]],
  ["eVajQPuRmk8", "en", ["spacing"]],
  ["h2AF8Y5AKbo", "vi", ["spacing"]],
  ["fp_YbxuJJkQ", "es", ["spacing"]],
  ["XG0CAM_VYdE", "pt", ["spacing"]],

  ["kV64Bu6sec0", "en", ["interleaving"]],
  ["4wJEB0cEUok", "en", ["interleaving"]],

  ["gQRzW24KrDc", "en", ["elaboration"]],

  ["tkm0TNFzIeg", "en", ["explain"]],
  ["_f-qkGJBPts", "en", ["explain"]],
  ["XCd8tC1fei0", "vi", ["explain"]],
  ["noevwClxaVA", "es", ["explain"]],
  ["JG0xf0nP69o", "pt", ["explain"]],
  ["TVHUs67kwRk", "pt", ["explain"]],

  ["7wF0lCBMh9Y", "en", ["examples"]],
  ["6xCZ4XnkpCc", "en", ["dual"]],
  ["XPllm-gtrMM", "en", ["generate", "judge"]],

  ["f2O6mQkFiiw", "en", ["deliberate"]],
  ["WbUOY9ioIqw", "en", ["deliberate"]],
  ["T4Z4N4zl0_Q", "vi", ["deliberate"]],

  ["a6brY4se_WM", "en", ["judge"]],

  ["QACB1z6I8LQ", "en", ["breaks"]],
  ["mNBmG24djoY", "en", ["breaks"]],
  ["vm_-taF_CRw", "vi", ["breaks"]],

  ["6TyIY6u31gk", "en", ["sleep"]],
  ["gedoSfZvBgE", "en", ["sleep"]],

  ["rhgwIhB58PA", "en", ["myths"]],
  ["NvM4mnEIxuQ", "en", ["myths"]],
];

function read(id) {
  const out = execFileSync("yt-dlp", ["--no-warnings", "--skip-download", "-J", `https://www.youtube.com/watch?v=${id}`], {
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  return JSON.parse(out);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const videos = [];
  for (const [id, lang, methods] of CHOSEN) {
    const v = read(id);
    if (v.availability !== "public" || v.playable_in_embed === false) throw new Error(`${id}: ${v.availability}, embeddable ${v.playable_in_embed}`);
    // YouTube does not always say; then the listed language stands, checked by hand.
    if (!v.language) console.warn(`\n${id}: YouTube gives no language; keeping ${lang}, checked by hand`);
    else if (v.language.slice(0, 2) !== lang) throw new Error(`${id} is in ${v.language}, listed as ${lang}`);
    videos.push({
      id,
      lang,
      methods,
      title: v.title,
      channel: v.channel ?? v.uploader ?? "",
      seconds: Math.round(v.duration ?? 0),
      published: v.upload_date ? `${v.upload_date.slice(0, 4)}-${v.upload_date.slice(4, 6)}-${v.upload_date.slice(6, 8)}` : "",
    });
    process.stdout.write(".");
  }
  const checked = new Date().toISOString().slice(0, 10);
  writeFileSync(OUT, `${JSON.stringify({ checked, videos }, null, 2)}\n`);
  console.log(`\n${videos.length} videos, checked ${checked}`);
}
