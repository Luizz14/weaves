import { dlopen, FFIType } from "bun:ffi";

const CLOCK_MONOTONIC_RAW = 4;

const libSystem = dlopen("/usr/lib/libSystem.B.dylib", {
	clock_gettime_nsec_np: { args: [FFIType.u32], returns: FFIType.u64 },
});

export function systemMonotonicNs(): bigint {
	return BigInt(libSystem.symbols.clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW));
}
