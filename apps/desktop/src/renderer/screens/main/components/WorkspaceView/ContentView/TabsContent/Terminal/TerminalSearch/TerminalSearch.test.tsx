import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { SearchAddon } from "@xterm/addon-search";
import { TerminalSearch } from "./TerminalSearch";

const registered = GlobalRegistrator.isRegistered;
if (!registered) GlobalRegistrator.register();
const { act, cleanup, fireEvent, render } = await import(
	"@testing-library/react"
);
const previousLocale = i18n.locale;
i18n.load("en", { Find: "Find" });
i18n.activate("en");
afterEach(() => {
	cleanup();
	mock.restore();
});
afterAll(async () => {
	if (previousLocale) i18n.activate(previousLocale);
	if (!registered) await GlobalRegistrator.unregister();
});
function deferred() {
	let resolve!: (addon: SearchAddon | null) => void;
	const promise = new Promise<SearchAddon | null>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
}
function addon() {
	const value = new SearchAddon();
	const find = spyOn(value, "findNext").mockReturnValue(true);
	spyOn(value, "clearDecorations").mockImplementation(() => {});
	return { value, find };
}
const close = () => {};
const view = (ensure: () => Promise<SearchAddon | null>, open = true) => (
	<I18nProvider i18n={i18n}>
		<TerminalSearch
			searchAddon={null}
			ensureSearchAddon={ensure}
			isOpen={open}
			onClose={close}
		/>
	</I18nProvider>
);

test("keeps typing available and applies the pending query when the addon arrives", async () => {
	const pending = deferred();
	const ensure = () => pending.promise;
	const search = addon();
	const result = render(view(ensure));
	const input = result.getByPlaceholderText("Find");
	fireEvent.change(input, { target: { value: "needle" } });
	expect(search.find).not.toHaveBeenCalled();
	await act(async () => pending.resolve(search.value));
	expect(search.find).toHaveBeenCalledWith(
		"needle",
		expect.objectContaining({ caseSensitive: false }),
	);
	expect(result.getByPlaceholderText("Find")).toBe(input);
	expect((input as HTMLInputElement).value).toBe("needle");
});

test("closing before loading skips stale searches and reopening reapplies the query", async () => {
	const pending = deferred();
	const ensure = () => pending.promise;
	const search = addon();
	const result = render(view(ensure));
	fireEvent.change(result.getByPlaceholderText("Find"), {
		target: { value: "needle" },
	});
	result.rerender(view(ensure, false));
	await act(async () => pending.resolve(search.value));
	expect(search.find).not.toHaveBeenCalled();
	await act(async () => result.rerender(view(ensure, true)));
	expect(search.find).toHaveBeenCalledWith("needle", expect.anything());
});

test("a replaced loader cannot apply a query to the previous terminal's addon", async () => {
	const first = deferred(),
		next = deferred();
	const ensureFirst = () => first.promise,
		ensureNext = () => next.promise;
	const original = addon(),
		replacement = addon();
	original.find.mockReturnValue(false);
	const result = render(view(ensureFirst));
	fireEvent.change(result.getByPlaceholderText("Find"), {
		target: { value: "needle" },
	});
	await act(async () => first.resolve(original.value));
	const before = original.find.mock.calls.length;
	expect(result.queryByText("No results")).not.toBeNull();
	result.rerender(view(ensureNext));
	expect(result.queryByText("No results")).toBeNull();
	await act(async () => next.resolve(replacement.value));
	expect(original.find).toHaveBeenCalledTimes(before);
	expect(replacement.find).toHaveBeenCalledWith("needle", expect.anything());
});
