import { describe, expect, test } from "bun:test";
import { summarizeDistribution } from "../lib/stats";
import { formatMs, renderReport } from "../report/render";

describe("renderReport", () => {
	test("formats milliseconds in pt-BR", () => {
		expect(formatMs(52.34)).toBe("52,3 ms");
		expect(formatMs(3328)).toBe("3.328 ms");
		expect(formatMs(12_500)).toBe("12,5 s");
		expect(formatMs(null)).toBe("—");
	});

	test("renders cards, the unmeasured send card and escapes metadata", () => {
		const html = renderReport({
			run: {
				appVersion: "1.29.0",
				gitHead: "abc",
				hardware: "<Mac>",
				macos: "27.0",
			},
			summary: {
				journeys: [
					{
						journey: "new-terminal",
						variant: "warm",
						distribution: summarizeDistribution([100, 120, 140, 160]),
						attempts: 4,
						timeouts: 1,
						invalid: 0,
						invalidReasons: {},
						markMediansMs: {},
						loafMedianBlockingMs: 0,
					},
				],
				launch: null,
			},
		});
		expect(html).toContain("<title>Latência das jornadas Superset</title>");
		expect(html).toContain("Novo terminal");
		expect(html).toContain("1 timeout");
		expect(html).toContain("Enviar mensagem ao modelo");
		expect(html).toContain("&lt;Mac&gt;");
		expect(html).not.toContain("<Mac>");
	});
});
