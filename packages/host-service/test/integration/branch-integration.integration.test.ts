import { afterEach, expect, test } from "bun:test";
import { type BasicScenario, createBasicScenario } from "../helpers/scenarios";

let scenario: BasicScenario | undefined;
afterEach(async () => {
	await scenario?.dispose();
	scenario = undefined;
});
test("project settings default to enabled, persist independently, and enforce authentication", async () => {
	scenario = await createBasicScenario();
	const { host, projectId, workspaceId, repo } = scenario;
	const original = await host.trpc.branchIntegration.settings.query({
		projectId,
	});
	expect(original.mergeToMainEnabled).toBe(true);
	expect(original.updateFromMainEnabled).toBe(true);
	expect(original.mergeTargetBranch).toBeNull();
	await host.trpc.branchIntegration.setSettings.mutate({
		projectId,
		mergeTargetBranch: "main",
		updateRemote: null,
		mergeToMainEnabled: false,
		updateFromMainEnabled: true,
	});
	const saved = await host.trpc.branchIntegration.settings.query({ projectId });
	expect(saved.mergeToMainEnabled).toBe(false);
	expect(saved.updateFromMainEnabled).toBe(true);
	await repo.git.checkoutLocalBranch("feature");
	await expect(
		host.trpc.branchIntegration.start.mutate({ workspaceId, kind: "merge" }),
	).rejects.toThrow("DISABLED");
	await host.trpc.branchIntegration.setSettings.mutate({
		projectId,
		mergeTargetBranch: "main",
		updateRemote: null,
		mergeToMainEnabled: true,
		updateFromMainEnabled: false,
	});
	await expect(
		host.trpc.branchIntegration.start.mutate({ workspaceId, kind: "update" }),
	).rejects.toThrow("DISABLED");
	await expect(
		host.unauthenticatedTrpc.branchIntegration.settings.query({ projectId }),
	).rejects.toThrow();
	await expect(
		host.unauthenticatedTrpc.branchIntegration.setSettings.mutate({
			projectId,
			mergeTargetBranch: "main",
			updateRemote: null,
			mergeToMainEnabled: true,
			updateFromMainEnabled: true,
		}),
	).rejects.toThrow();
}, 30000);
