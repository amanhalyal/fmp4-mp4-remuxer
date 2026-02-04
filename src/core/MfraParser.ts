import type { Box } from './Mp4BoxParser';
import { parseBoxes, readU32, readU64, u8 } from './Mp4BoxParser';

export type TfraEntry = {
	time: bigint;
	moofOffset: bigint;
	trafNumber: bigint;
	trunNumber: bigint;
	sampleNumber: bigint;
};

export type TfraBox = {
	box: Box;
	version: number;
	flags: number;
	trackId: number;
	lengthSizeOfTrafNum: number;
	lengthSizeOfTrunNum: number;
	lengthSizeOfSampleNum: number;
	entries: TfraEntry[];
};

export type MfroBox = {
	box: Box;
	version: number;
	flags: number;
	mfraSize: number;
};

export type MfraBox = {
	box: Box;
	tfra: TfraBox[];
	mfro?: MfroBox;
};

function readU8(data: Uint8Array, offset: number): number {
	return data[offset] ?? 0;
}

function readU24(data: Uint8Array, offset: number): number {
	return ((data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2]) >>> 0;
}

function readFullBoxHeader(data: Uint8Array, offset: number): { version: number; flags: number; next: number } {
	const version = readU8(data, offset);
	const flags = readU24(data, offset + 1);
	return { version, flags, next: offset + 4 };
}

function readUIntN(data: Uint8Array, offset: number, byteCount: number): { value: bigint; next: number } {
	if (byteCount <= 0 || byteCount > 8) {
		throw new Error(`Unsupported integer byte length: ${byteCount}`);
	}
	if (offset + byteCount > data.byteLength) {
		throw new Error('Unexpected end of buffer while reading integer');
	}

	let out = 0n;
	for (let i = 0; i < byteCount; i++) {
		out = (out << 8n) | BigInt(data[offset + i]);
	}
	return { value: out, next: offset + byteCount };
}

export function findTopLevelMfra(input: ArrayBuffer | Uint8Array): Box | undefined {
	const data = u8(input);
	return parseBoxes(data).find((b) => b.type === 'mfra');
}

export function parseTfraBox(data: Uint8Array, box: Box): TfraBox {
	let off = box.start + box.headerSize;
	const { version, flags, next } = readFullBoxHeader(data, off);
	off = next;

	if (version !== 0 && version !== 1) {
		throw new Error(`Unsupported tfra version: ${version}`);
	}

	const trackId = readU32(data, off);
	off += 4;

	const packed = readU32(data, off);
	off += 4;

	const lengthSizeOfTrafNum = ((packed >> 4) & 0x3) + 1;
	const lengthSizeOfTrunNum = ((packed >> 2) & 0x3) + 1;
	const lengthSizeOfSampleNum = (packed & 0x3) + 1;

	const numberOfEntries = readU32(data, off);
	off += 4;

	const entries: TfraEntry[] = [];
	for (let i = 0; i < numberOfEntries; i++) {
		if (off >= box.end) {
			throw new Error('Unexpected end of tfra while reading entries');
		}

		let time: bigint;
		let moofOffset: bigint;
		if (version === 1) {
			time = readU64(data, off);
			off += 8;
			moofOffset = readU64(data, off);
			off += 8;
		} else {
			time = BigInt(readU32(data, off));
			off += 4;
			moofOffset = BigInt(readU32(data, off));
			off += 4;
		}

		const traf = readUIntN(data, off, lengthSizeOfTrafNum);
		off = traf.next;
		const trun = readUIntN(data, off, lengthSizeOfTrunNum);
		off = trun.next;
		const sample = readUIntN(data, off, lengthSizeOfSampleNum);
		off = sample.next;

		entries.push({
			time,
			moofOffset,
			trafNumber: traf.value,
			trunNumber: trun.value,
			sampleNumber: sample.value,
		});
	}

	return {
		box,
		version,
		flags,
		trackId,
		lengthSizeOfTrafNum,
		lengthSizeOfTrunNum,
		lengthSizeOfSampleNum,
		entries,
	};
}

export function parseMfroBox(data: Uint8Array, box: Box): MfroBox {
	let off = box.start + box.headerSize;
	const { version, flags, next } = readFullBoxHeader(data, off);
	off = next;

	// mfro is a FullBox containing a 32-bit size.
	const mfraSize = readU32(data, off);

	return { box, version, flags, mfraSize };
}

export function parseMfraBox(input: ArrayBuffer | Uint8Array, mfraBox?: Box): MfraBox {
	const data = u8(input);
	const box = mfraBox ?? findTopLevelMfra(data);
	if (!box) {
		throw new Error('mfra box not found');
	}

	const children = parseBoxes(data, box.start + box.headerSize, box.end);
	const tfra: TfraBox[] = [];
	let mfro: MfroBox | undefined;

	for (const child of children) {
		if (child.type === 'tfra') {
			tfra.push(parseTfraBox(data, child));
		}
		if (child.type === 'mfro') {
			mfro = parseMfroBox(data, child);
		}
	}

	return { box, tfra, mfro };
}

export function tryParseMfraBox(input: ArrayBuffer | Uint8Array): MfraBox | undefined {
	const data = u8(input);
	const mfra = findTopLevelMfra(data);
	if (!mfra) return undefined;
	return parseMfraBox(data, mfra);
}
