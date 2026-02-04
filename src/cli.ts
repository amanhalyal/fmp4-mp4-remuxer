#!/usr/bin/env node

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { flattenFmp4ToMp4WithOptions } from './core/index';

type CliOptions = {
  dirPath: string;
  initPath?: string;
  outPath: string;
  fragments: string[];
  normalizeAcrossFiles: boolean;
  allowTrunDataOffsetFallback: boolean;
};

function printHelp(): void {
  // Keep this dependency-free (no commander/yargs).
  process.stdout.write(`\
Usage:
  fmp4-mp4-remuxer [options]
  fmp4-mp4-remuxer [options] <fragment1> <fragment2> ...

Options:
  --dir <dir>                           Directory containing fMP4 files (default: ./fmp4-files)
  --init <path>                          Path to init segment (optional; auto-detected by default)
  --out <path>                           Output MP4 path (default: ./out.mp4)
  --normalize-across-files              Normalize timestamps across multiple inputs
  --allow-trun-data-offset-fallback     Allow fallback parsing when trun.data_offset is missing
  -h, --help                            Show this help

Examples:
  fmp4-mp4-remuxer --out out.mp4
  fmp4-mp4-remuxer --dir ./fmp4-files --out out.mp4
  fmp4-mp4-remuxer --init ./fmp4-files/init.mp4 --out out.mp4 ./fmp4-files/seg-001.m4s ./fmp4-files/seg-002.m4s
`);
}

function parseArgs(argv: string[]): CliOptions | { help: true } {
  const options: Partial<CliOptions> = {
    dirPath: path.resolve(process.cwd(), 'fmp4-files'),
    outPath: path.resolve(process.cwd(), 'out.mp4'),
    fragments: [],
    normalizeAcrossFiles: false,
    allowTrunDataOffsetFallback: false
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '-h' || arg === '--help') {
      return { help: true };
    }

    if (arg === '--dir') {
      options.dirPath = argv[++index];
      continue;
    }

    if (arg === '--out') {
      options.outPath = argv[++index];
      continue;
    }

    if (arg === '--init') {
      options.initPath = argv[++index];
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

  options.dirPath = path.resolve(process.cwd(), options.dirPath!);
  options.outPath = path.resolve(process.cwd(), options.outPath!);
  if (options.initPath) {
    options.initPath = path.resolve(process.cwd(), options.initPath);
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

function pickInitFile(filePaths: string[]): string | undefined {
  const initCandidates = filePaths.filter((filePath) => {
    const baseName = path.basename(filePath).toLowerCase();
    return baseName === 'init.mp4' || baseName === 'init.m4s';
  });

  if (initCandidates.length === 1) {
    return initCandidates[0];
  }

  if (initCandidates.length > 1) {
    throw new Error(`Multiple init segment candidates found: ${initCandidates.map((p) => path.basename(p)).join(', ')}`);
  }

  return undefined;
}

function isLikelyFragmentFile(filePath: string): boolean {
  const baseName = path.basename(filePath).toLowerCase();
  if (baseName === 'init.mp4' || baseName === 'init.m4s') {
    return false;
  }

  const ext = path.extname(baseName);
  return ext === '.m4s' || ext === '.mp4' || ext === '.bin';
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('help' in parsed) {
    printHelp();
    process.exitCode = 0;
    return;
  }

  const { dirPath, initPath, outPath, fragments, normalizeAcrossFiles, allowTrunDataOffsetFallback } = parsed;

  const dirFiles = await listFragmentFiles(dirPath);
  const resolvedInitPath = initPath ?? pickInitFile(dirFiles);
  if (!resolvedInitPath) {
    throw new Error('Init segment not found. Put init.mp4 (or init.m4s) in --dir, or pass --init <path>.');
  }

  const fragmentPaths = fragments.length > 0 ? fragments.map((p) => path.resolve(process.cwd(), p)) : dirFiles.filter(isLikelyFragmentFile);
  if (fragmentPaths.length === 0) {
    throw new Error('No fragments found. Put .m4s fragments in --dir or pass fragment paths as positional args.');
  }

  const init = toArrayBuffer(await readFile(resolvedInitPath));
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
