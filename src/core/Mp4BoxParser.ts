export type Box = {
	type: string;
	start: number;
	size: number;
	headerSize: number;
	end: number;
};

export function u8(buf: ArrayBuffer | Uint8Array): Uint8Array {
	return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

export function readU32(data: Uint8Array, offset: number): number {
	return (
		(data[offset] << 24) |
		(data[offset + 1] << 16) |
		(data[offset + 2] << 8) |
		data[offset + 3]
	) >>> 0;
}

export function readI32(data: Uint8Array, offset: number): number {
	return (readU32(data, offset) | 0);
}

export function readU64(data: Uint8Array, offset: number): bigint {
	const hi = BigInt(readU32(data, offset));
	const lo = BigInt(readU32(data, offset + 4));
	return (hi << 32n) | lo;
}

export function readType(data: Uint8Array, offset: number): string {
	return String.fromCharCode(
		data[offset],
		data[offset + 1],
		data[offset + 2],
		data[offset + 3]
	);
}

export function parseBoxes(data: Uint8Array, start = 0, end = data.byteLength): Box[] {
	const boxes: Box[] = [];
	let off = start;
	while (off + 8 <= end) {
		const size32 = readU32(data, off);
		const type = readType(data, off + 4);

		let size = size32;
		let headerSize = 8;

		if (size32 === 1) {
			if (off + 16 > end) break;
			const size64 = readU64(data, off + 8);
			if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) {
				throw new Error(`Box ${type} too large to address safely`);
			}
			size = Number(size64);
			headerSize = 16;
		} else if (size32 === 0) {
			size = end - off;
		}

		if (size < headerSize || off + size > end) break;

		boxes.push({ type, start: off, size, headerSize, end: off + size });
		off += size;
	}
	return boxes;
}

export function sliceBox(data: Uint8Array, box: Box): Uint8Array {
	return data.slice(box.start, box.end);
}

export function concat(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((s, c) => s + c.byteLength, 0);
	const out = new Uint8Array(total);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.byteLength;
	}
	return out;
}

export function summarizeTopLevelBoxes(data: Uint8Array): string {
	const boxes = parseBoxes(data);
	return boxes.map((b) => `${b.type}@${b.start}+${b.size}`).join(' ');
}
