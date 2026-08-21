#!/usr/bin/env node
/**
 * verify-blog-spawn.mjs [transcript.jsonl]
 *
 * Model-route check: blogs MUST be a Sonnet child, not parent Opus.
 * Exit 0 if the transcript shows model=sonnet near a blog/POSTS spawn.
 * Exit 2 if the file exists but no spawn was found (parent likely drafted).
 * Exit 1 on usage.
 */
import { readFileSync, existsSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: verify-blog-spawn.mjs <session-transcript.jsonl>');
  process.exit(1);
}
if (!existsSync(path)) {
  console.error(`missing ${path}`);
  process.exit(1);
}
const text = readFileSync(path, 'utf8');
const sonnetBlog =
  /model["\s:=]+sonnet/i.test(text) &&
  /blog-data|POSTS:\s*Post|Draft 5 blog/i.test(text);
const parentDrafted =
  /blog-data\.ts/i.test(text) && !/model["\s:=]+sonnet/i.test(text);

if (sonnetBlog) {
  console.log('BLOG_SPAWN=SONNET');
  process.exit(0);
}
if (parentDrafted) {
  console.log('BLOG_SPAWN=PARENT_OPUS — free 4–7+ min and a large Opus tax');
  process.exit(2);
}
console.log('BLOG_SPAWN=UNSEEN — no blog spawn in this transcript');
process.exit(2);
