import type { FlatMp4Result, FlattenOptions } from '../types/Types';
import { u8, parseBoxes, summarizeTopLevelBoxes } from './Mp4BoxParser';
export * from './MfraParser';
import { InitSegmentParser } from './InitSegmentParser';
import { FragmentParser } from './FragmentParser';
import { TimelineNormalizer } from './TimelineNormalizer';
import { Mp4Builder } from './Mp4Builder';

function dbg(opts: FlattenOptions | undefined, ...args: unknown[]) {
	if (opts?.debug) {
		// eslint-disable-next-line no-console
		console.log('[mp4muxer]', ...args);
	}
}

function validateOptions(opts: FlattenOptions) {
	if (opts.debugFileLimit !== undefined) {
		if (!Number.isFinite(opts.debugFileLimit) || opts.debugFileLimit < 0) {
			throw new Error('debugFileLimit must be a non-negative number');
		}
	}
}

function splitInitAndFragments(buffers: ArrayBuffer[]): { init: ArrayBuffer; fragments: ArrayBuffer[] } {
	let init: ArrayBuffer | null = null;
	const fragments: ArrayBuffer[] = [];

	for (const buf of buffers) {
		const data = u8(buf);
		const boxes = parseBoxes(data);
		const moovIdx = boxes.findIndex((b) => b.type === 'moov');
		const moofIdx = boxes.findIndex((b) => b.type === 'moof');

		if (moovIdx >= 0 && moofIdx === -1) {
			if (!init) init = buf;
			else fragments.push(buf);
			continue;
		}

		if (moovIdx === -1 && moofIdx >= 0) {
			fragments.push(buf);
			continue;
		}

		if (moovIdx >= 0 && moofIdx >= 0) {
			if (!init) init = buf;
			fragments.push(buf);
			continue;
		}

		if (moovIdx >= 0) {
			if (!init) init = buf;
			else fragments.push(buf);
		} else {
			fragments.push(buf);
		}
	}

	if (!init) {
		throw new Error('Could not locate MP4 init segment (missing moov)');
	}

	return { init, fragments };
}

export async function flattenFmp4ToMp4(buffers: ArrayBuffer[]): Promise<FlatMp4Result> {
	return flattenFmp4ToMp4WithOptions(buffers, {});
}

export async function flattenFmp4ToMp4WithOptions(buffers: ArrayBuffer[], opts: FlattenOptions): Promise<FlatMp4Result> {
	validateOptions(opts);

	const { init, fragments } = splitInitAndFragments(buffers);
	dbg(opts, 'input buffers=', buffers.length, 'init+fragments=', fragments.length + 1);
	dbg(opts, 'init boxes:', summarizeTopLevelBoxes(u8(init)));

	const config = new InitSegmentParser().parse(u8(init));
	dbg(opts, 'config=', { trackId: config.trackId, timescale: config.timescale, width: config.width, height: config.height });

	const limit = opts.debugFileLimit ?? 3;
	const perFileSamples = fragments.map((frag, idx) => {
		const shouldLog = opts.debug ? (idx < limit || idx >= fragments.length - limit) : false;
		const fileOpts = shouldLog ? opts : { ...opts, debug: false };
		dbg(fileOpts, `file[${idx}] bytes=`, frag.byteLength);
		return new FragmentParser(config, fileOpts).parse(u8(frag));
	});

	const normalizer = new TimelineNormalizer();
	const normalized = normalizer.normalizeFragments(perFileSamples, opts);

	if (opts.debug) {
		const keyframes = normalized.samples.filter((s) => s.isKeyframe).length;
		dbg(opts, 'global samples=', normalized.samples.length, 'keyframes=', keyframes);
	}

	const built = new Mp4Builder().build(config, normalized.samples);
	return {
		...built,
		discontinuityDetected: normalized.discontinuityDetected || undefined,
	};
}

export class Fmp4Flattener {
	private readonly opts: FlattenOptions;

	constructor(opts: FlattenOptions = {}) {
		this.opts = opts;
	}

	async flatten(buffers: ArrayBuffer[]): Promise<FlatMp4Result> {
		return flattenFmp4ToMp4WithOptions(buffers, this.opts);
	}
}

export default {
	flattenFmp4ToMp4,
	flattenFmp4ToMp4WithOptions,
	Fmp4Flattener,
};
