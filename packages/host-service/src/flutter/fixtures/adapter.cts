if (process.argv[2] === "devices") {
	console.log(
		JSON.stringify([
			{ id: "fixture-device", name: "Fixture", targetPlatform: "linux" },
		]),
	);
	process.exit(0);
}
let buffer = Buffer.alloc(0),
	sequence = 0;
function send(message: Record<string, unknown>) {
	const body = Buffer.from(JSON.stringify({ seq: ++sequence, ...message }));
	process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
	process.stdout.write(body);
}
process.stdin.on("data", (chunk: Buffer) => {
	buffer = Buffer.concat([buffer, chunk]);
	while (true) {
		const end = buffer.indexOf("\r\n\r\n");
		if (end < 0) return;
		const length = Number(
			/Content-Length: (\d+)/.exec(buffer.subarray(0, end).toString())?.[1],
		);
		if (buffer.length < end + 4 + length) return;
		const request = JSON.parse(
			buffer.subarray(end + 4, end + 4 + length).toString(),
		);
		buffer = buffer.subarray(end + 4 + length);
		send({
			type: "response",
			request_seq: request.seq,
			command: request.command,
			success: true,
			body: {},
		});
		if (request.command === "launch") {
			send({ type: "event", event: "initialized" });
			send({ type: "event", event: "flutter.appStarted" });
		}
		if (request.command === "hotReload")
			send({
				type: "event",
				event: "output",
				body: { output: "Reloaded fixture\n" },
			});
		if (request.command === "disconnect") process.exit(0);
	}
});
