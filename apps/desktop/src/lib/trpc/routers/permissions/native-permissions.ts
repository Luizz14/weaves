import {
	getNativePermissionSnapshot,
	invokeNative,
} from "main/native/platform";
import { z } from "zod";

export const PERMISSION_SETTINGS_URLS = {
	fullDiskAccess:
		"x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
	accessibility:
		"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
	microphone:
		"x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
	appleEvents:
		"x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Automation",
	localNetwork:
		"x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_LocalNetwork",
} as const;

type ShellApi = { openExternal: (url: string) => Promise<void> };
type SystemPreferencesApi = {
	askForMediaAccess: (mediaType: "microphone") => Promise<boolean>;
	getMediaAccessStatus: (mediaType: "microphone") => string;
	isTrustedAccessibilityClient: (prompt: boolean) => boolean;
};

const nativePermissionStatusSchema = z.object({
	fullDiskAccess: z.boolean(),
	accessibility: z.boolean(),
	microphone: z.boolean(),
});

function getNativeSystemPreferences(): SystemPreferencesApi {
	return {
		askForMediaAccess: (mediaType) =>
			invokeNative<boolean>("permissions.requestMedia", { mediaType }, null),
		getMediaAccessStatus: (mediaType) => {
			const value = getNativePermissionSnapshot()[mediaType];
			const status: string = typeof value === "string" ? value : "denied";
			return status;
		},
		isTrustedAccessibilityClient: () => {
			const value = getNativePermissionSnapshot().accessibility;
			const trusted: boolean = typeof value === "boolean" ? value : false;
			return trusted;
		},
	};
}

export function checkAccessibility({
	systemPreferencesApi = getNativeSystemPreferences(),
}: {
	systemPreferencesApi?: Pick<
		SystemPreferencesApi,
		"isTrustedAccessibilityClient"
	>;
} = {}): boolean {
	return systemPreferencesApi?.isTrustedAccessibilityClient(false) ?? false;
}

export function checkMicrophone({
	systemPreferencesApi = getNativeSystemPreferences(),
}: {
	systemPreferencesApi?: Pick<SystemPreferencesApi, "getMediaAccessStatus">;
} = {}): boolean {
	try {
		return (
			systemPreferencesApi?.getMediaAccessStatus("microphone") === "granted"
		);
	} catch {
		return false;
	}
}

export async function getPermissionStatus() {
	const native = nativePermissionStatusSchema.parse(
		await invokeNative<unknown>("permissions.status"),
	);
	return native;
}

export async function requestFullDiskAccess({
	shellApi,
}: {
	shellApi?: ShellApi;
} = {}): Promise<void> {
	if (shellApi) {
		await shellApi.openExternal(PERMISSION_SETTINGS_URLS.fullDiskAccess);
		return;
	}
	await invokeNative("permissions.openSettings", {
		permission: "fullDiskAccess",
	});
}

export async function requestAccessibility({
	shellApi,
}: {
	shellApi?: ShellApi;
} = {}): Promise<void> {
	if (shellApi) {
		await shellApi.openExternal(PERMISSION_SETTINGS_URLS.accessibility);
		return;
	}
	await invokeNative("permissions.openSettings", {
		permission: "accessibility",
	});
}

export async function requestMicrophone({
	shellApi,
	systemPreferencesApi,
}: {
	shellApi?: ShellApi;
	systemPreferencesApi?: Pick<SystemPreferencesApi, "askForMediaAccess">;
} = {}): Promise<{ granted: boolean }> {
	try {
		if (process.platform === "darwin") {
			const preferencesApi =
				systemPreferencesApi ?? getNativeSystemPreferences();
			const granted = await preferencesApi?.askForMediaAccess("microphone");
			if (granted) {
				return { granted: true };
			}
		}
	} catch {
		// Fall through to opening System Settings.
	}

	if (shellApi) {
		await shellApi.openExternal(PERMISSION_SETTINGS_URLS.microphone);
	} else {
		await invokeNative("permissions.openSettings", {
			permission: "microphone",
		});
	}
	return { granted: false };
}

export async function requestAppleEvents({
	shellApi,
}: {
	shellApi?: ShellApi;
} = {}): Promise<void> {
	if (shellApi) {
		await shellApi.openExternal(PERMISSION_SETTINGS_URLS.appleEvents);
		return;
	}
	await invokeNative("permissions.openSettings", { permission: "appleEvents" });
}

export async function requestLocalNetwork({
	shellApi,
}: {
	shellApi?: ShellApi;
} = {}): Promise<void> {
	if (shellApi) {
		await shellApi.openExternal(PERMISSION_SETTINGS_URLS.localNetwork);
		return;
	}
	await invokeNative("permissions.openSettings", {
		permission: "localNetwork",
	});
}
