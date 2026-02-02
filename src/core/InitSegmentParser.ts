import type { TrackConfig } from '../types/Types.ts';
import { parseBoxes, readU32, readType, sliceBox } from './Mp4BoxParser';

export class InitSegmentParser {
	parse(init: Uint8Array): TrackConfig {
		return this.parseInitConfig(init);
	}

	private findFtyp(init: Uint8Array): Uint8Array | undefined {
		const boxes = parseBoxes(init);
		const ftyp = boxes.find((b) => b.type === 'ftyp');
		return ftyp ? sliceBox(init, ftyp) : undefined;
	}

	private tkhdTrackId(trak: Uint8Array): number | null {
		const outer = parseBoxes(trak)[0];
		const start = outer ? outer.headerSize : 0;
		const end = outer ? outer.end : trak.byteLength;
		const boxes = parseBoxes(trak, start, end);
		const tkhd = boxes.find((b) => b.type === 'tkhd');
		if (!tkhd) return null;

		const contentStart = tkhd.start + tkhd.headerSize;
		if (contentStart + 4 > tkhd.end) return null;

		const version = trak[contentStart];
		const base = contentStart + 4;
		if (version === 0) {
			if (base + 16 > tkhd.end) return null;
			return readU32(trak, base + 8);
		}
		if (version === 1) {
			if (base + 28 > tkhd.end) return null;
			return readU32(trak, base + 16);
		}
		return null;
	}

	private findStsdForTrack(init: Uint8Array, trackId: number): Uint8Array {
		const top = parseBoxes(init);
		const moov = top.find((b) => b.type === 'moov');
		if (!moov) throw new Error('Init segment missing moov');

		const moovData = init.slice(moov.start + moov.headerSize, moov.end);
		const traks = parseBoxes(moovData).filter((b) => b.type === 'trak');

		for (const trakBox of traks) {
			const trak = moovData.slice(trakBox.start, trakBox.end);
			const id = this.tkhdTrackId(trak);
			if (id !== trackId) continue;

			const trakContent = trak.slice(trakBox.headerSize);
			const mdia = parseBoxes(trakContent).find((b) => b.type === 'mdia');
			if (!mdia) break;

			const mdiaContent = trakContent.slice(mdia.start + mdia.headerSize, mdia.end);
			const minf = parseBoxes(mdiaContent).find((b) => b.type === 'minf');
			if (!minf) break;

			const minfContent = mdiaContent.slice(minf.start + minf.headerSize, minf.end);
			const stbl = parseBoxes(minfContent).find((b) => b.type === 'stbl');
			if (!stbl) break;

			const stblContent = minfContent.slice(stbl.start + stbl.headerSize, stbl.end);
			const stsd = parseBoxes(stblContent).find((b) => b.type === 'stsd');
			if (!stsd) break;

			return sliceBox(stblContent, stsd);
		}

		throw new Error(`Could not locate stsd for trackId=${trackId}`);
	}

	private parseMdhdTimescale(mdia: Uint8Array): number {
		const mdhd = parseBoxes(mdia).find((b) => b.type === 'mdhd');
		if (!mdhd) throw new Error('Init segment missing mdhd');
		const contentStart = mdhd.start + mdhd.headerSize;
		const version = mdia[contentStart];
		const base = contentStart + 4;
		if (version === 0) {
			if (base + 16 > mdhd.end) throw new Error('Invalid mdhd (v0)');
			return readU32(mdia, base + 8);
		}
		if (version === 1) {
			if (base + 28 > mdhd.end) throw new Error('Invalid mdhd (v1)');
			return readU32(mdia, base + 16);
		}
		throw new Error(`Unsupported mdhd version ${version}`);
	}

	private parseHdlrType(mdia: Uint8Array): string | null {
		const hdlr = parseBoxes(mdia).find((b) => b.type === 'hdlr');
		if (!hdlr) return null;
		const contentStart = hdlr.start + hdlr.headerSize;
		const base = contentStart + 4;
		if (base + 8 > hdlr.end) return null;
		return readType(mdia, base + 4);
	}

	private parseTkhdDimensions(trak: Uint8Array): { width: number; height: number } {
		const outer = parseBoxes(trak)[0];
		const start = outer ? outer.headerSize : 0;
		const end = outer ? outer.end : trak.byteLength;
		const tkhd = parseBoxes(trak, start, end).find((b) => b.type === 'tkhd');
		if (!tkhd) throw new Error('Init segment missing tkhd');

		if (tkhd.end - 8 < tkhd.start) throw new Error('Invalid tkhd');
		const widthFixed = readU32(trak, tkhd.end - 8);
		const heightFixed = readU32(trak, tkhd.end - 4);
		return { width: widthFixed >>> 16, height: heightFixed >>> 16 };
	}

	private parseInitConfig(init: Uint8Array): TrackConfig {
		const top = parseBoxes(init);
		const moov = top.find((b) => b.type === 'moov');
		if (!moov) throw new Error('Init segment missing moov');

		const moovData = init.slice(moov.start + moov.headerSize, moov.end);
		const traks = parseBoxes(moovData).filter((b) => b.type === 'trak');

		for (const trakBox of traks) {
			const trak = moovData.slice(trakBox.start, trakBox.end);
			const trakContent = trak.slice(trakBox.headerSize);
			const mdia = parseBoxes(trakContent).find((b) => b.type === 'mdia');
			if (!mdia) continue;
			const mdiaContent = trakContent.slice(mdia.start + mdia.headerSize, mdia.end);
			const handler = this.parseHdlrType(mdiaContent);
			if (handler !== 'vide') continue;

			const trackId = this.tkhdTrackId(trak);
			if (!trackId) continue;

			const timescale = this.parseMdhdTimescale(mdiaContent);
			const { width, height } = this.parseTkhdDimensions(trak);
			const stsd = this.findStsdForTrack(init, trackId);
			const ftyp = this.findFtyp(init);

			if (!timescale || !Number.isFinite(timescale)) {
				throw new Error('Invalid timescale in init');
			}

			return { trackId, timescale, width, height, stsd, ftyp };
		}

		throw new Error('No video track found in init segment');
	}
}

export default InitSegmentParser;
