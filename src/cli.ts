#!/usr/bin/env node

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { flattenFmp4ToMp4WithOptions } from './core/index';

type CliOptions = {
  initPath: string;
  outPath: string;
  fragments: string[];
  fragmentsDir?: string;
  normalizeAcrossFiles: boolean;
  allowTrunDataOffsetFallback: boolean;
};

function printHelp(): void {
  // Keep this dependency-free (no commander/yargs).
  process.stdout.write(`\
Usage:
  fmp4-mp4-remuxer --init <init.mp4> --out <out.mp4> [options] <fragment1> <fragment2> ...

Options:
  --init <path>                         Path to init segment (contains moov)
  --out <path>                          Output MP4 path
  --fragments-dir <dir>                 Read fragments from a directory (sorted by filename)
  --normalize-across-files              Normalize timestamps across multiple inputs
  --allow-trun-data-offset-fallback     Allow fallback parsing when trun.data_offset is missing
  -h, --help                            Show this help

Examples:
  fmp4-mp4-remuxer --init init.mp4 --out out.mp4 frag-001.m4s frag-002.m4s
  fmp4-mp4-remuxer --init init.mp4 --out out.mp4 --fragments-dir ./frags --normalize-across-files
`);
}

function parseArgs(argv: string[]): CliOptions | { help: true } {
  const options: Partial<CliOptions> = {
    fragments: [],
    normalizeAcrossFiles: false,
    allowTrunDataOffsetFallback: false
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '-h' || arg === '--help') {
      return { help: true };
    }

    if (arg === '--init') {
      options.initPath = argv[++index];
      continue;
    }

    if (arg === '--out') {
      options.outPath = argv[++index];
      continue;
    }

    if (arg === '--fragments-dir') {
      options.fragmentsDir = argv[++index];
      continue;
    }

    if (arg === '--normalize-across-files') {
      options.normalizeAcrossFiles = true;
      continue;
    }

    if (arg === '--allow-trun-data-offset-fallback') {
      options.allowTrunDataOffsetFallback = true;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.fragments!.push(arg);
  }

  if (!options.initPath) {
    throw new Error('Missing required option: --init <path>');
  }

  if (!options.outPath) {
    throw new Error('Missing required option: --out <path>');
  }

  return options as CliOptions;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}

async function listFragmentFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath);
  const sorted = entries.slice().sort((a, b) => a.localeCompare(b));

  const files: string[] = [];
  for (const entry of sorted) {
    const fullPath = path.join(dirPath, entry);
    const st = await stat(fullPath);
    if (st.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('help' in parsed) {
    printHelp();
    process.exitCode = 0;
    return;
  }

  const { initPath, outPath, fragmentsDir, fragments, normalizeAcrossFiles, allowTrunDataOffsetFallback } = parsed;

  const fragmentPaths = fragmentsDir ? await listFragmentFiles(fragmentsDir) : fragments;
  if (fragmentPaths.length === 0) {
    throw new Error('No fragments provided. Pass fragment paths as positional args or use --fragments-dir <dir>.');
  }

  const init = toArrayBuffer(await readFile(initPath));
  const fragmentBuffers = await Promise.all(fragmentPaths.map(async (p) => toArrayBuffer(await readFile(p))));

  const { buffer, idrTimestamps } = await flattenFmp4ToMp4WithOptions(
    [init, ...fragmentBuffers],
    { normalizeAcrossFiles, allowTrunDataOffsetFallback }
  );

  const outBytes = new Uint8Array(buffer);
  await writeFile(outPath, outBytes);

  process.stdout.write(`Wrote ${outPath} (${outBytes.byteLength} bytes)\n`);
  if (idrTimestamps?.length) {
    process.stdout.write(`IDR frames: ${idrTimestamps.length}\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  printHelp();
  process.exitCode = 1;
});
