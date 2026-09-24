import { expect, test } from "bun:test";
import {
	parseMacOSMinimums,
	validateMacOSMinimum,
} from "./verify-macos-runtime";

test("extracts deployment targets from modern and legacy Mach-O commands", () => {
	expect(
		parseMacOSMinimums(`fixture:
Load command 8
      cmd LC_BUILD_VERSION
 platform 1
    minos 13.5
      sdk 15.0
Load command 9
      cmd LC_LOAD_DYLIB
  current version 99.0.0
Load command 10
      cmd LC_VERSION_MIN_MACOSX
  version 11.0
      sdk 14.0
`),
	).toEqual(["13.5", "11.0"]);
});

test("does not treat an iOS build target as a macOS deployment target", () => {
	expect(
		parseMacOSMinimums(
			"Load command 1\n cmd LC_BUILD_VERSION\n platform 2\n minos 18.0\n",
		),
	).toEqual([]);
});

test("rejects the CEF-only minimum when the bundled Node requires a newer macOS", () => {
	expect(() =>
		validateMacOSMinimum("13.0", [
			{ path: "CEF", minimum: "13.0" },
			{ path: "node", minimum: "13.5" },
		]),
	).toThrow("node: requires macOS 13.5");
});

test("compares versions numerically and allows older native dependencies", () => {
	expect(
		validateMacOSMinimum("13.10", [
			{ path: "node", minimum: "13.5.0" },
			{ path: "addon", minimum: "11.0" },
		]),
	).toBe("13.5.0");
});

test("rejects malformed versions and vacuous validation", () => {
	expect(() => validateMacOSMinimum("latest", [])).toThrow(
		"Invalid macOS version",
	);
	expect(() => validateMacOSMinimum("13.5", [])).toThrow("No macOS binaries");
});
