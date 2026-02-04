#!/usr/bin/env node

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { flattenFmp4ToMp4WithOptions } from './core/index';

type CliOptions = {
  dirPath: string;
  initPath?: string;
  outPath: string;
  inputs: string[];
  normalizeAcrossFiles?: boolean;
  allowTrunDataOffsetFallback: boolean;
};

function printHelp(): void {
  process.stdout.write(`\
Merge fragmented MP4 inputs into a single MP4.

Usage:
  fmp4-mp4-remuxer [options] <file1> <file2> ...
  fmp4-mp4-remuxer --dir <dir> [options]

Options:
  --dir <dir>                       Directory containing fragmented MP4 files
  --init <path>                     Optional init segment for DASH-style inputs
  --out <path>                      Output MP4 path (default: ./out.mp4)
  --normalize-across-files          Normalize timestamps across inputs (default)
  --no-normalize-across-files       Disable cross-input timestamp normalization
  --allow-trun-data-offset-fallback Allow fallback parsing when trun.data_offset missing
  -h, --help                        Show help

Examples:
  fmp4-mp4-remuxer a.mp4 b.mp4 --out merged.mp4
  fmp4-mp4-remuxer --dir ./fragments --out merged.mp4
  fmp4-mp4-remuxer --init init.mp4 seg1.m4s seg2.m4s --out merged.mp4
`);
}

function parseArgs(argv: string[]): CliOptions | { help: true } {
  const options: Partial<CliOptions> = {
    dirPath: '',
    outPath: path.resolve(process.cwd(), 'out.mp4'),
    inputs: [],
    normalizeAcrossFiles: undefined,
    allowTrunDataOffsetFallback: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') return { help: true };

    if (arg === '--dir') {
      options.dirPath = path.resolve(process.cwd(), argv[++i]);
      continue;
    }

    if (arg === '--out') {
      options.outPath = path.resolve(process.cwd(), argv[++i]);
      continue;
    }

    if (arg === '--init') {
      options.initPath = path.resolve(process.cwd(), argv[++i]);
      continue;
    }

    if (arg === '--normalize-across-files') {
      options.normalizeAcrossFiles = true;
      continue;
    }

    if (arg === '--no-normalize-across-files') {
      options.normalizeAcrossFiles = false;
      continue;
    }

    if (arg === '--allow-trun-data-offset-fallback') {
      options.allowTrunDataOffsetFallback = true;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.inputs!.push(path.resolve(process.cwd(), arg));
  }

  return options as CliOptions;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(buffer);
  return ab;
}

async function listFilesSorted(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath);

  // Natural numeric sort (important for segment order)
  entries.sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );

  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dirPath, entry);
    const st = await stat(full);
    if (st.isFile()) files.push(full);
  }

  return files;
}

function isLikelyInputFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.mp4' || ext === '.m4s';
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if ('help' in parsed) {
    printHelp();
    return;
  }

  let { dirPath, initPath, outPath, inputs, normalizeAcrossFiles, allowTrunDataOffsetFallback } = parsed;

  // Load directory inputs only if --dir provided
  const dirFiles = dirPath
    ? (await listFilesSorted(dirPath)).filter(isLikelyInputFile)
    : [];

  const inputPaths =
    inputs.length > 0
      ? inputs
      : dirFiles;

  if (inputPaths.length === 0) {
    throw new Error('No input files provided.');
  }

  const buffers: ArrayBuffer[] = [];

  // DASH-style mode (explicit init)
  if (initPath) {
    buffers.push(toArrayBuffer(await readFile(initPath)));

    const fragmentPaths = inputPaths.filter(
      (p) => path.resolve(p) !== path.resolve(initPath)
    );

    if (fragmentPaths.length === 0) {
      throw new Error('No fragment files found alongside --init.');
    }

    const fragmentBuffers = await Promise.all(
      fragmentPaths.map(async (p) => toArrayBuffer(await readFile(p)))
    );

    buffers.push(...fragmentBuffers);
  } else {
    // Self-contained fragmented MP4 files
    const fileBuffers = await Promise.all(
      inputPaths.map(async (p) => toArrayBuffer(await readFile(p)))
    );

    buffers.push(...fileBuffers);
  }

  const flattenOpts: { normalizeAcrossFiles?: boolean; allowTrunDataOffsetFallback?: boolean } = {
    allowTrunDataOffsetFallback
  };
  if (typeof normalizeAcrossFiles === 'boolean') {
    flattenOpts.normalizeAcrossFiles = normalizeAcrossFiles;
  }

  const { buffer, idrTimestamps } = await flattenFmp4ToMp4WithOptions(buffers, flattenOpts);

  const outBytes = new Uint8Array(buffer);
  await writeFile(outPath, outBytes);

  process.stdout.write(`✔ Wrote ${outPath} (${outBytes.byteLength} bytes)\n`);
  if (idrTimestamps?.length) {
    process.stdout.write(`✔ IDR frames: ${idrTimestamps.length}\n`);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${msg}\n\n`);
  printHelp();
  process.exit(1);
});
