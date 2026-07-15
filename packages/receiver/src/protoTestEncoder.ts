/**
 * Minimal protobuf encoder — TEST ONLY.
 *
 * Not exported from the package entry (`index.ts`), so it is never bundled into
 * `dist` and never published. It exists purely to build OTLP protobuf byte
 * payloads for the decoder tests, giving us a controlled encoding to assert
 * against without pulling in a protobuf runtime.
 *
 * Field numbers and wire types mirror the OTLP proto definitions used by
 * `otlpProtobuf.ts`.
 */

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LEN = 2;

const textEncoder = new TextEncoder();

export class ProtoWriter {
	private readonly parts: number[] = [];

	private tag(field: number, wire: number): void {
		this.varint(BigInt((field << 3) | wire));
	}

	varint(value: bigint | number): this {
		let v = BigInt.asUintN(64, BigInt(value));
		for (;;) {
			const byte = Number(v & 0x7fn);
			v >>= 7n;
			if (v === 0n) {
				this.parts.push(byte);
				break;
			}
			this.parts.push(byte | 0x80);
		}
		return this;
	}

	/** Encode a varint field (int32/int64/uint/bool/enum). */
	varintField(field: number, value: bigint | number | boolean): this {
		this.tag(field, WIRE_VARINT);
		this.varint(typeof value === 'boolean' ? (value ? 1 : 0) : value);
		return this;
	}

	/** Encode a fixed64 field (little-endian 8 bytes). */
	fixed64Field(field: number, value: bigint | number): this {
		this.tag(field, WIRE_FIXED64);
		let v = BigInt.asUintN(64, BigInt(value));
		for (let i = 0; i < 8; i++) {
			this.parts.push(Number(v & 0xffn));
			v >>= 8n;
		}
		return this;
	}

	/** Encode a double field (little-endian IEEE754, wire type fixed64). */
	doubleField(field: number, value: number): this {
		this.tag(field, WIRE_FIXED64);
		const buf = new ArrayBuffer(8);
		new DataView(buf).setFloat64(0, value, true);
		for (const b of new Uint8Array(buf)) {
			this.parts.push(b);
		}
		return this;
	}

	/** Encode a packed `repeated fixed64` field (length-delimited). */
	packedFixed64Field(field: number, values: readonly (bigint | number)[]): this {
		const bytes: number[] = [];
		for (const value of values) {
			let v = BigInt.asUintN(64, BigInt(value));
			for (let i = 0; i < 8; i++) {
				bytes.push(Number(v & 0xffn));
				v >>= 8n;
			}
		}
		return this.bytesField(field, new Uint8Array(bytes));
	}

	/** Encode a packed `repeated double` field (length-delimited). */
	packedDoubleField(field: number, values: readonly number[]): this {
		const buf = new ArrayBuffer(8 * values.length);
		const view = new DataView(buf);
		values.forEach((v, i) => view.setFloat64(i * 8, v, true));
		return this.bytesField(field, new Uint8Array(buf));
	}

	/** Encode a length-delimited field (bytes/string/embedded message). */
	bytesField(field: number, value: Uint8Array): this {
		this.tag(field, WIRE_LEN);
		this.varint(value.length);
		for (const b of value) {
			this.parts.push(b);
		}
		return this;
	}

	stringField(field: number, value: string): this {
		return this.bytesField(field, textEncoder.encode(value));
	}

	/** Encode an embedded message field from a nested writer. */
	messageField(field: number, writer: ProtoWriter): this {
		return this.bytesField(field, writer.finish());
	}

	finish(): Uint8Array {
		return new Uint8Array(this.parts);
	}
}

/** Convert a hex ID string (trace/span id) to the raw bytes protobuf carries. */
export function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}
