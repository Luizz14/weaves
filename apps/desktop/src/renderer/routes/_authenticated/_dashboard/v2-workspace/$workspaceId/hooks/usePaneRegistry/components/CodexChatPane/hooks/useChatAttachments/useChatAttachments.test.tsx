import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

const upload = mock(async (_input: unknown) => ({ attachmentId: "srv-1" }));

mock.module("renderer/lib/host-service-client", () => ({
	getHostServiceClientByUrl: () => ({
		attachments: { upload: { mutate: upload } },
	}),
}));

const { render, cleanup, act } = await import("@testing-library/react");
const { useChatAttachments } = await import("./useChatAttachments");

type Api = ReturnType<typeof useChatAttachments>;

let api: Api;

function Harness({ hostUrl }: { hostUrl: string | null }) {
	api = useChatAttachments(hostUrl);
	return null;
}

function file(name: string, contents = "hello", type = "image/png"): File {
	return new File([contents], name, { type, lastModified: 1 });
}

async function mount(hostUrl: string | null = "http://127.0.0.1:1234") {
	await act(async () => {
		render(<Harness hostUrl={hostUrl} />);
	});
}

async function addAndSettle(files: File[]) {
	await act(async () => {
		api.add(files);
	});
	await act(async () => {
		await api.awaitReady();
	});
}

beforeEach(() => {
	upload.mockClear();
	upload.mockImplementation(async () => ({ attachmentId: "srv-1" }));
});

afterEach(cleanup);

test("a successful upload flips the pill to ready and awaitReady returns its id", async () => {
	await mount();

	await addAndSettle([file("shot.png")]);

	expect(api.attachments).toHaveLength(1);
	expect(api.attachments[0].state).toEqual({
		kind: "ready",
		attachmentId: "srv-1",
	});

	const result = await api.awaitReady();
	expect(result.errors).toEqual([]);
	expect(result.ready).toEqual([
		{ attachmentId: "srv-1", name: "shot.png", mimeType: "image/png" },
	]);
});

test("a failing upload leaves an error pill and shows up in awaitReady errors", async () => {
	upload.mockImplementation(async () => {
		throw new Error("host exploded");
	});
	await mount();

	await addAndSettle([file("notes.txt", "abc", "text/plain")]);

	expect(api.attachments).toHaveLength(1);
	expect(api.attachments[0].state).toEqual({
		kind: "error",
		message: "host exploded",
	});

	const result = await api.awaitReady();
	expect(result.ready).toEqual([]);
	expect(result.errors).toEqual([
		{ name: "notes.txt", message: "host exploded" },
	]);
});

test("retry re-uploads a failed attachment", async () => {
	upload.mockImplementation(async () => {
		throw new Error("host exploded");
	});
	await mount();

	await addAndSettle([file("shot.png")]);
	expect(api.attachments[0].state.kind).toBe("error");

	upload.mockImplementation(async () => ({ attachmentId: "srv-2" }));
	await act(async () => {
		api.retry(api.attachments[0].id);
	});
	await act(async () => {
		await api.awaitReady();
	});

	expect(api.attachments[0].state).toEqual({
		kind: "ready",
		attachmentId: "srv-2",
	});
});

test("remove drops the attachment and clear empties the tray", async () => {
	await mount();

	await addAndSettle([file("a.png"), file("b.png")]);
	expect(api.attachments).toHaveLength(2);

	await act(async () => {
		api.remove(api.attachments[0].id);
	});
	expect(api.attachments.map((a) => a.name)).toEqual(["b.png"]);

	await act(async () => {
		api.clear();
	});
	expect(api.attachments).toEqual([]);
	expect(await api.awaitReady()).toEqual({ ready: [], errors: [] });
});

test("duplicates by name, size and lastModified are ignored", async () => {
	await mount();

	await addAndSettle([file("same.png")]);
	await addAndSettle([file("same.png")]);

	expect(api.attachments).toHaveLength(1);
	expect(upload).toHaveBeenCalledTimes(1);
});

test("awaitReady resolves immediately when nothing is in flight", async () => {
	await mount();

	expect(await api.awaitReady()).toEqual({ ready: [], errors: [] });
});

test("adding without a host errors the attachment instead of throwing", async () => {
	await mount(null);

	await addAndSettle([file("shot.png")]);

	expect(api.attachments[0].state.kind).toBe("error");
	expect(upload).not.toHaveBeenCalled();
	const result = await api.awaitReady();
	expect(result.ready).toEqual([]);
	expect(result.errors).toHaveLength(1);
});
