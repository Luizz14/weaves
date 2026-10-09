import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const secret = randomBytes(32);

export function issueIdeContextToken(
	organizationId: string,
	workspaceId: string,
	terminalId: string,
): string {
	return createHmac("sha256", secret)
		.update(
			JSON.stringify([
				"terminal-ide-context",
				organizationId,
				workspaceId,
				terminalId,
			]),
		)
		.digest("hex");
}

export function verifyIdeContextToken(
	organizationId: string,
	workspaceId: string,
	terminalId: string,
	token: string,
): boolean {
	return (
		/^[a-f0-9]{64}$/.test(token) &&
		timingSafeEqual(
			Buffer.from(token, "hex"),
			Buffer.from(
				issueIdeContextToken(organizationId, workspaceId, terminalId),
				"hex",
			),
		)
	);
}
