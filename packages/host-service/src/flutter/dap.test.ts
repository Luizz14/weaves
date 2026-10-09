import { expect, test } from "bun:test";
import { DapFrames } from "./dap";

function frame(value: object) {
	const body = Buffer.from(JSON.stringify(value));
	return Buffer.concat([
		Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),
		body,
	]);
}
test("DAP framing handles split unicode bytes and coalesced messages", () => {
	const first = { type: "event", event: "output", body: { output: "ação 🎯" } },
		second = { type: "response", request_seq: 1, success: true };
	const buffer = Buffer.concat([frame(first), frame(second)]),
		parser = new DapFrames();
	const messages: unknown[] = [];
	for (const byte of buffer) messages.push(...parser.push(Buffer.from([byte])));
	expect(messages).toEqual([first, second]);
	expect(new DapFrames().push(buffer)).toEqual([first, second]);
});
test("DAP framing rejects malformed and oversized input", () => {
	expect(() =>
		new DapFrames().push(Buffer.from("Content-Length: invalid\r\n\r\n")),
	).toThrow();
	expect(() =>
		new DapFrames().push(Buffer.from("Content-Length: 999999999\r\n\r\n")),
	).toThrow();
});
