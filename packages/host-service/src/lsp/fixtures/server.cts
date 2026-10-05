let buffer = Buffer.alloc(0);
let pendingConfiguration: string | number | null = null;
function send(message: Record<string, unknown>) {
	const body = JSON.stringify({ jsonrpc: "2.0", ...message });
	const frame = Buffer.from(
		`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
	);
	process.stdout.write(frame.subarray(0, 11));
	process.stdout.write(frame.subarray(11));
}
process.stdin.on("data", (chunk) => {
	buffer = Buffer.concat([buffer, chunk]);
	while (true) {
		const header = buffer.indexOf("\r\n\r\n");
		if (header < 0) return;
		const lengthMatch = /Content-Length: (\d+)/.exec(
			buffer.subarray(0, header).toString(),
		);
		if (!lengthMatch) throw new Error("Missing content length");
		const length = Number(lengthMatch[1]);
		if (buffer.length < header + 4 + length) return;
		const message: {
			id?: string | number | null;
			method?: string;
			result?: unknown;
			params: {
				rootUri: string;
				capabilities: { general: { positionEncodings: string[] } };
				textDocument: { uri: string; version: number };
			};
		} = JSON.parse(buffer.subarray(header + 4, header + 4 + length).toString());
		buffer = buffer.subarray(header + 4 + length);
		if (message.method === "initialize")
			send({
				id: message.id,
				result: {
					capabilities: {
						textDocumentSync: 2,
						completionProvider: {},
						hoverProvider: true,
						definitionProvider: true,
					},
					root: message.params.rootUri,
					encoding: message.params.capabilities.general.positionEncodings,
				},
			});
		else if (message.method === "test/configuration") {
			pendingConfiguration = message.id ?? null;
			send({
				id: "configuration",
				method: "workspace/configuration",
				params: { items: [{ section: "yaml.schemas" }] },
			});
		} else if (message.id === "configuration")
			send({ id: pendingConfiguration, result: message.result });
		else if (message.method === "textDocument/didOpen")
			send({
				method: "textDocument/publishDiagnostics",
				params: {
					uri: message.params.textDocument.uri,
					version: message.params.textDocument.version,
					diagnostics: [
						{
							message: "ação 🐟",
							severity: 1,
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 1 },
							},
						},
					],
				},
			});
		else if (message.method === "shutdown")
			send({ id: message.id, result: null });
		else if (message.method === "exit") process.exit(0);
		else if (message.id != null) send({ id: message.id, result: null });
	}
});
