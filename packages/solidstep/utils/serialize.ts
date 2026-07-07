import {
    crossSerializeStream,
    deserialize,
    getCrossReferenceHeader,
    type Plugin,
} from 'seroval';
import {
    CustomEventPlugin,
    DOMExceptionPlugin,
    EventPlugin,
    FormDataPlugin,
    HeadersPlugin,
    ReadableStreamPlugin,
    RequestPlugin,
    ResponsePlugin,
    URLPlugin,
    URLSearchParamsPlugin,
} from 'seroval-plugins/web';

/**
 * The seroval plugins used to (de)serialize server-action arguments and return
 * values across the network boundary. Shared by both the server and client
 * transports (and the `fromJSON`/`toJSONAsync` argument codecs) so the set
 * stays in sync.
 */
export const SEROVAL_PLUGINS: Plugin<any, any>[] = [
    CustomEventPlugin,
    DOMExceptionPlugin,
    EventPlugin,
    FormDataPlugin,
    HeadersPlugin,
    ReadableStreamPlugin,
    RequestPlugin,
    ResponsePlugin,
    URLSearchParamsPlugin,
    URLPlugin,
];

/**
 * Frames a serialized string into a length-prefixed binary chunk.
 *
 * The 12-byte header is `;0x<8-hex-digit byte length>;`, followed by the UTF-8
 * encoded payload. {@link SerovalChunkReader} reads this framing back.
 */
export function createChunk(data: string) {
    const encodeData = new TextEncoder().encode(data);
    const bytes = encodeData.length;
    const baseHex = bytes.toString(16);
    const totalHex = '00000000'.substring(0, 8 - baseHex.length) + baseHex; // 32-bit
    const head = new TextEncoder().encode(`;0x${totalHex};`);

    const chunk = new Uint8Array(12 + bytes);
    chunk.set(head);
    chunk.set(encodeData, 12);
    return chunk;
}

/**
 * Cross-serializes `value` into a chunked `ReadableStream` of length-prefixed
 * frames. The first chunk carries the cross-reference header for `id` so the
 * reader can resolve references that arrive in later chunks (e.g. streamed
 * promises / readable streams).
 *
 * @param id - The cross-reference scope id (the server-action instance id).
 * @param value - Any value supported by the {@link SEROVAL_PLUGINS}.
 */
export function serializeToStream(id: string, value: any) {
    return new ReadableStream({
        start(controller) {
            crossSerializeStream(value, {
                scopeId: id,
                plugins: SEROVAL_PLUGINS,
                onSerialize(data, initial) {
                    controller.enqueue(
                        createChunk(
                            initial
                                ? `(${getCrossReferenceHeader(id)},${data})`
                                : data,
                        ),
                    );
                },
                onDone() {
                    controller.close();
                },
                /* v8 ignore next 3 -- defensive: forwards async seroval
                   serialization failures; not deterministically triggerable
                   from a unit test without relying on seroval internals. */
                onError(error) {
                    controller.error(error);
                },
            });
        },
    });
}

/**
 * Reads a chunked stream produced by {@link serializeToStream}, decoding one
 * length-prefixed frame at a time and deserializing it back into a value.
 *
 * Buffers partial reads until a full frame (per its length header) is
 * available, then deserializes it.
 */
export class SerovalChunkReader {
    reader: ReadableStreamDefaultReader<Uint8Array>;
    buffer: Uint8Array;
    done: boolean;

    constructor(stream: ReadableStream<Uint8Array>) {
        this.reader = stream.getReader();
        this.buffer = new Uint8Array(0);
        this.done = false;
    }

    async readChunk() {
        // if there's no chunk, read again
        const chunk = await this.reader.read();
        if (!chunk.done) {
            // repopulate the buffer
            const newBuffer = new Uint8Array(
                this.buffer.length + chunk.value.length,
            );
            newBuffer.set(this.buffer);
            newBuffer.set(chunk.value, this.buffer.length);
            this.buffer = newBuffer;
        } else {
            this.done = true;
        }
    }

    async next(): Promise<any> {
        // Check if the buffer is empty
        if (this.buffer.length === 0) {
            // if we are already done...
            if (this.done) {
                return {
                    done: true,
                    value: undefined,
                };
            }
            // Otherwise, read a new chunk
            await this.readChunk();
            return await this.next();
        }
        // The 12-byte header itself can arrive split across reads (e.g. a
        // network chunk boundary landing inside it), so buffer until it's
        // fully present before decoding it — otherwise a truncated slice can
        // parse as a plausible-looking but wrong length.
        while (this.buffer.length < 12 && !this.done) {
            await this.readChunk();
        }
        if (this.buffer.length < 12) {
            throw new Error(
                'Malformed server function stream: truncated header',
            );
        }

        // Read the "byte header"
        // The byte header tells us how big the expected data is
        // so we know how much data we should wait before we
        // deserialize the data
        const head = new TextDecoder().decode(this.buffer.subarray(1, 11));
        const bytes = Number.parseInt(head, 16); // ;0x00000000;
        if (Number.isNaN(bytes)) {
            throw new Error(`Malformed server function stream header: ${head}`);
        }

        // Check if the buffer has enough bytes to be parsed
        while (bytes > this.buffer.length - 12) {
            // If it's not enough, and the reader is done
            // then the chunk is invalid.
            if (this.done) {
                throw new Error('Malformed server function stream.');
            }
            // Otherwise, we read more chunks
            await this.readChunk();
        }
        // Extract the exact chunk as defined by the byte header
        const partial = new TextDecoder().decode(
            this.buffer.subarray(12, 12 + bytes),
        );
        // The rest goes to the buffer
        this.buffer = this.buffer.subarray(12 + bytes);

        // Deserialize the chunk
        return {
            done: false,
            value: deserialize(partial),
        };
    }

    async drain() {
        while (true) {
            const result = await this.next();
            if (result.done) {
                break;
            }
        }
    }
}
