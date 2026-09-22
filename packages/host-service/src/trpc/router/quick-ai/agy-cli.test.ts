import { describe, expect, it } from "bun:test";
import { parseAgyJsonOutput, QuickAiError } from "./agy-cli";

describe("parseAgyJsonOutput", () => {
	it("extracts structured output from the CLI envelope", () => {
		expect(
			parseAgyJsonOutput(
				JSON.stringify({
					status: "SUCCESS",
					response: '{"message":"fix: repair login"}',
					structured_output: { message: "fix: repair login" },
				}),
			),
		).toEqual({ message: "fix: repair login" });
	});

	it("rejects malformed CLI output", () => {
		expect(() => parseAgyJsonOutput("not-json")).toThrow(QuickAiError);
	});

	it("rejects output without the schema-enforced result", () => {
		expect(() =>
			parseAgyJsonOutput(JSON.stringify({ response: "Here you go" })),
		).toThrow("did not contain structured output");
	});
});
