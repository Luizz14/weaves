import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

const { render, cleanup, fireEvent } = await import("@testing-library/react");
const { AttachmentTray } = await import("./AttachmentTray");
type ChatAttachment = import("../../hooks/useChatAttachments").ChatAttachment;

afterEach(cleanup);

const image: ChatAttachment = {
	id: "a1",
	name: "a-very-long-screenshot-filename.png",
	mimeType: "image/png",
	sizeBytes: 2048,
	previewUrl: "blob:preview",
	state: { kind: "ready", attachmentId: "srv-1" },
};

test("the tray renders nothing when there are no attachments", () => {
	const view = render(
		<AttachmentTray attachments={[]} onRemove={() => undefined} />,
	);

	expect(view.container.firstChild).toBeNull();
});

test("removing a pill reports the attachment id", () => {
	const onRemove = mock((_id: string) => undefined);
	const view = render(
		<AttachmentTray attachments={[image]} onRemove={onRemove} />,
	);

	expect(view.getByText(image.name)).toBeDefined();
	expect(view.getByText("2 KB")).toBeDefined();

	fireEvent.click(view.getByLabelText("Remove attachment"));

	expect(onRemove).toHaveBeenCalledWith("a1");
});

test("an errored pill shows its message and offers a retry when handled", () => {
	const onRetry = mock((_id: string) => undefined);
	const errored: ChatAttachment = {
		...image,
		id: "a2",
		state: { kind: "error", message: "host exploded" },
	};
	const view = render(
		<AttachmentTray
			attachments={[errored]}
			onRemove={() => undefined}
			onRetry={onRetry}
		/>,
	);

	expect(view.getByText("host exploded")).toBeDefined();

	fireEvent.click(view.getByLabelText("Retry upload"));

	expect(onRetry).toHaveBeenCalledWith("a2");
});

test("the retry affordance is hidden when no handler is given", () => {
	const errored: ChatAttachment = {
		...image,
		state: { kind: "error", message: "host exploded" },
	};
	const view = render(
		<AttachmentTray attachments={[errored]} onRemove={() => undefined} />,
	);

	expect(view.queryByLabelText("Retry upload")).toBeNull();
});
