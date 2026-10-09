(() => {
	if (window.__perfProbe) return;
	if (location.protocol !== "file:" || window.top !== window) return;

	const now = () => performance.now();
	const sockets = [];
	const frameListeners = new Set();
	const loafEntries = [];
	const focusLog = [];
	const textDecoder = new TextDecoder();

	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				loafEntries.push({
					start: entry.startTime,
					end: entry.startTime + entry.duration,
					blocking: entry.blockingDuration ?? 0,
				});
				if (loafEntries.length > 2000) loafEntries.splice(0, 1000);
			}
		}).observe({ type: "long-animation-frame", buffered: true });
	} catch {}

	window.addEventListener("blur", (event) => {
		if (event.target === window) focusLog.push(["blur", now()]);
	});
	window.addEventListener("focus", (event) => {
		if (event.target === window) focusLog.push(["focus", now()]);
	});
	document.addEventListener("visibilitychange", () =>
		focusLog.push([document.visibilityState, now()]),
	);

	function classify(url) {
		const record = {
			kind: "other",
			terminalId: null,
			workspaceId: null,
			create: false,
			port: null,
			local: false,
		};
		try {
			const parsed = new URL(String(url));
			record.port = parsed.port || null;
			record.local =
				parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
			const terminal = parsed.pathname.match(/\/terminal\/([^/]+)$/);
			if (terminal) {
				record.kind = "terminal";
				record.terminalId = decodeURIComponent(terminal[1]);
				record.workspaceId = parsed.searchParams.get("workspaceId");
				record.create = parsed.searchParams.has("create");
			} else if (/\/events$/.test(parsed.pathname)) {
				record.kind = "events";
			}
		} catch {}
		return record;
	}

	function emit(info) {
		for (const listener of frameListeners) {
			try {
				listener(info);
			} catch {}
		}
	}

	const NativeWebSocket = window.WebSocket;
	class ProbedWebSocket extends NativeWebSocket {
		constructor(url, protocols) {
			super(url, protocols);
			const record = {
				...classify(url),
				id: sockets.length + 1,
				createdAt: now(),
				openAt: null,
				attachedAt: null,
				syncedAt: null,
				lastBinaryAt: null,
				binaryFrames: 0,
			};
			sockets.push(record);
			this.__probeRecord = record;
			emit({ type: "socket-created", record, t: record.createdAt });
			this.addEventListener("open", () => {
				record.openAt = now();
			});
			this.addEventListener("close", () => {
				record.closedAt = now();
			});
			this.addEventListener("message", (event) => {
				const t = now();
				const data = event.data;
				if (typeof data === "string") {
					let message = null;
					try {
						message = JSON.parse(data);
					} catch {}
					const type =
						message && typeof message.type === "string" ? message.type : null;
					if (record.kind === "terminal") {
						if (type === "attached" && record.attachedAt === null)
							record.attachedAt = t;
						if (type === "synced") record.syncedAt = t;
					}
					emit({
						type: "json",
						record,
						t,
						messageType: type,
						eventType:
							message && typeof message.eventType === "string"
								? message.eventType
								: null,
						messageTerminalId:
							message && typeof message.terminalId === "string"
								? message.terminalId
								: null,
						messageWorkspaceId:
							message && typeof message.workspaceId === "string"
								? message.workspaceId
								: null,
					});
					return;
				}
				record.binaryFrames += 1;
				record.lastBinaryAt = t;
				const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : null;
				emit({ type: "binary", record, t, bytes });
			});
		}
		send(data) {
			const record = this.__probeRecord;
			if (
				record &&
				typeof data === "string" &&
				data.startsWith('{"type":"input"')
			) {
				emit({ type: "input-sent", record, t: now() });
			}
			return super.send(data);
		}
	}
	window.WebSocket = ProbedWebSocket;

	function afterPaint(frames) {
		return new Promise((resolve) => {
			const step = (remaining) => {
				requestAnimationFrame(() => {
					if (remaining > 1) {
						step(remaining - 1);
						return;
					}
					const channel = new MessageChannel();
					channel.port1.onmessage = () => resolve(now());
					channel.port2.postMessage(null);
				});
			};
			step(frames);
		});
	}

	function isVisible(element) {
		if (!element || !element.isConnected) return false;
		if (element.closest("#terminal-parking")) return false;
		const rects = element.getClientRects();
		if (!rects.length) return false;
		const rect = rects[0];
		return rect.width > 0 && rect.height > 0;
	}

	function scope(within) {
		return within ? document.querySelector(within) : document;
	}

	const pendingStart = { spec: null, resolve: null };
	function matchesStart(spec, event) {
		if (!event.isTrusted) return false;
		if (spec.type === "keydown") {
			if (event.type !== "keydown") return false;
			if (spec.code && event.code !== spec.code) return false;
			if (spec.meta !== undefined && event.metaKey !== spec.meta) return false;
			if (spec.shift !== undefined && event.shiftKey !== spec.shift)
				return false;
			return true;
		}
		if (spec.type === "pointerdown") return event.type === "pointerdown";
		return false;
	}
	function onInputEvent(event) {
		const spec = pendingStart.spec;
		if (!spec || !matchesStart(spec, event)) return;
		const resolve = pendingStart.resolve;
		pendingStart.spec = null;
		pendingStart.resolve = null;
		resolve(event.timeStamp);
	}
	window.addEventListener("keydown", onInputEvent, true);
	window.addEventListener("pointerdown", onInputEvent, true);

	const CLAUDE_READY =
		/bypasspermissionson|forshortcuts|shift\+tab|│>|>│|try"/i;
	const CLAUDE_MARKERS = {
		shortcuts: /forshortcuts/i,
		bypass: /bypasspermissions/i,
		shiftTab: /shift\+tab/i,
		escInterrupt: /esctointerrupt/i,
		welcome: /welcome/i,
		claudeCode: /claudecode/i,
		help: /\/help/i,
		tryPrompt: /try"/i,
		acceptEdits: /acceptedits/i,
		planMode: /planmode/i,
		model: /opus|sonnet|haiku/i,
		context: /context/i,
		boxTop: /╭/,
		promptBox: /│>|>│|❯/,
		trust: /doyoutrust|trustthefiles/i,
		update: /update/i,
		login: /login|signin/i,
	};
	const CLAUDE_BLOCKED =
		/doyoutrust|trustthefiles|trustthisfolder|yes,iaccept/i;
	const ESC = String.fromCharCode(27);
	const BEL = String.fromCharCode(7);
	const ANSI = new RegExp(
		`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[@-_]`,
		"g",
	);

	function hashText(text) {
		let hash = 2166136261;
		for (let i = 0; i < text.length; i++) {
			hash ^= text.charCodeAt(i);
			hash = Math.imul(hash, 16777619);
		}
		return hash >>> 0;
	}

	function cssRuleCount() {
		let total = 0;
		for (const sheet of [
			...document.styleSheets,
			...(document.adoptedStyleSheets ?? []),
		]) {
			try {
				total += sheet.cssRules.length;
			} catch {}
		}
		return total;
	}

	function editorLines(root) {
		const scroller = root.querySelector(".cm-scroller");
		if (!scroller) return [];
		const box = scroller.getBoundingClientRect();
		const lines = [];
		for (const line of root.querySelectorAll(".cm-content .cm-line")) {
			const rect = line.getBoundingClientRect();
			if (rect.bottom <= box.top || rect.top >= box.bottom) continue;
			lines.push(line);
			if (lines.length >= 150) break;
		}
		return lines;
	}

	function highlightSignature(line) {
		let signature = "";
		const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const classes = [];
			for (
				let el = node.parentElement;
				el && el !== line;
				el = el.parentElement
			) {
				for (const name of el.classList)
					if (name.startsWith("\u037c")) classes.push(name);
			}
			signature += `${node.length}:${classes.sort().join(".")};`;
		}
		return signature;
	}

	function editorSnapshot(root, readyText) {
		const content = root.querySelector(".cm-content");
		const scroller = root.querySelector(".cm-scroller");
		const gutters = root.querySelector(".cm-gutters");
		const half = (value) => Math.round(value * 2) / 2;
		const status = [...root.querySelectorAll("output")]
			.map((el) => el.textContent ?? "")
			.join("|");
		let colors = "";
		let text = "";
		for (const line of editorLines(root)) {
			text += `${line.textContent}\n`;
			colors += `${highlightSignature(line)}\n`;
		}
		const scrollerRect = scroller?.getBoundingClientRect();
		return {
			contentLeft: content ? half(content.getBoundingClientRect().left) : null,
			scrollerTop: scrollerRect ? half(scrollerRect.top) : null,
			scrollerHeight: scrollerRect ? half(scrollerRect.height) : null,
			scrollerWidth: scrollerRect ? half(scrollerRect.width) : null,
			scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
			gutterWidth: gutters ? half(gutters.getBoundingClientRect().width) : null,
			lintGutter: !!root.querySelector(".cm-gutter-lint"),
			status,
			ready: readyText ? status.includes(readyText) : false,
			colors: hashText(colors),
			text: hashText(text),
			diagnostics: root.querySelectorAll(".cm-lintRange").length,
			hints: root.querySelectorAll(".cm-editor-inlay-hint").length,
		};
	}

	const LAYOUT_KEYS = [
		"contentLeft",
		"scrollerTop",
		"scrollerHeight",
		"scrollerWidth",
		"scrollTop",
		"gutterWidth",
		"lintGutter",
	];

	function containsText(root, text) {
		if (!root || !text) return false;
		return (root.textContent ?? "").includes(text);
	}

	const endConditions = {
		selector(params, ctx) {
			const existing = new WeakSet();
			if (params.isNew) {
				for (const element of document.querySelectorAll(params.selector))
					existing.add(element);
			}
			const check = () => {
				const root = scope(params.within);
				if (!root) return false;
				for (const element of root.querySelectorAll(params.selector)) {
					if (params.isNew && existing.has(element)) continue;
					if (params.attrNotIn) {
						const value = element.getAttribute(params.attrNotIn.name);
						if (params.attrNotIn.values.includes(value)) continue;
					}
					if (params.enabled && element.disabled) continue;
					if (
						params.textIncludes &&
						!(element.textContent ?? "").includes(params.textIncludes)
					)
						continue;
					if (!isVisible(element)) continue;
					if (params.attrOut) ctx.output = element.getAttribute(params.attrOut);
					return true;
				}
				return false;
			};
			return new Promise((resolve) => {
				const observer = new MutationObserver(() => {
					if (!ctx.started || ctx.done) return;
					if (check()) {
						observer.disconnect();
						ctx.mark("ready");
						afterPaint(1).then(resolve);
					}
				});
				observer.observe(document, {
					subtree: true,
					childList: true,
					attributes: true,
					characterData: true,
				});
				ctx.onStart(() => {
					if (check()) {
						observer.disconnect();
						ctx.mark("ready");
						afterPaint(1).then(resolve);
					}
				});
				ctx.cleanup.push(() => observer.disconnect());
			});
		},

		newDocument(params, ctx) {
			const existing = new Set(
				[...document.querySelectorAll("[data-editor-document-id]")].map((el) =>
					el.getAttribute("data-editor-document-id"),
				),
			);
			return new Promise((resolve) => {
				const check = () => {
					if (!ctx.started || ctx.done) return;
					const root = scope(params.within);
					if (!root) return;
					for (const el of root.querySelectorAll("[data-editor-document-id]")) {
						if (existing.has(el.getAttribute("data-editor-document-id")))
							continue;
						const line = el.querySelector(".cm-content .cm-line");
						if (!line || !isVisible(line)) continue;
						observer.disconnect();
						ctx.mark("ready");
						afterPaint(1).then(resolve);
						return;
					}
				};
				const observer = new MutationObserver(check);
				observer.observe(document, {
					subtree: true,
					childList: true,
					attributes: true,
				});
				ctx.onStart(check);
				ctx.cleanup.push(() => observer.disconnect());
			});
		},

		editorSettled(params, ctx) {
			const observeMs = params.observeMs ?? 2500;
			const readyText = params.readyText ?? null;
			const loadingText = params.loadingText ?? null;
			const existing = new Set(
				[...document.querySelectorAll("[data-editor-document-id]")].map((el) =>
					el.getAttribute("data-editor-document-id"),
				),
			);
			const rulesBefore = cssRuleCount();
			return new Promise((resolve) => {
				let target = null;
				let paintAt = null;
				let previous = null;
				let lastVisual = null;
				let framesBeforePaint = 0;
				let loadingFrames = 0;
				let shift = 0;
				const late = {
					layout: 0,
					colors: 0,
					status: 0,
					diagnostics: 0,
					hints: 0,
				};
				let shiftObserver = null;
				try {
					shiftObserver = new PerformanceObserver((list) => {
						if (!target) return;
						for (const entry of list.getEntries()) {
							if (
								(entry.sources ?? []).some(
									(source) => source.node && target.contains(source.node),
								)
							)
								shift += entry.value;
						}
					});
					shiftObserver.observe({ type: "layout-shift" });
				} catch {}
				ctx.cleanup.push(() => shiftObserver?.disconnect());
				const since = () => now() - ctx.startTs;
				const set = (name, value) => {
					ctx.marks[name] = value;
				};
				const finish = () => {
					set("paint", paintAt);
					set("framesBeforePaint", framesBeforePaint);
					set("loadingFrames", loadingFrames);
					set("lateLayout", late.layout);
					set("lateColors", late.colors);
					set("lateStatus", late.status);
					set("lateDiagnostics", late.diagnostics);
					set("lateHints", late.hints);
					set("layoutShift", Math.round(shift * 10000) / 10000);
					set("cssRulesAdded", cssRuleCount() - rulesBefore);
					resolve(ctx.startTs + (lastVisual ?? paintAt));
				};
				const frame = () => {
					if (ctx.done) return;
					if (!ctx.started) {
						requestAnimationFrame(frame);
						return;
					}
					const scopeRoot = scope(params.within);
					if (!target) {
						for (const el of scopeRoot?.querySelectorAll(
							"[data-editor-document-id]",
						) ?? []) {
							if (existing.has(el.getAttribute("data-editor-document-id")))
								continue;
							const line = el.querySelector(".cm-content .cm-line");
							if (line && isVisible(line)) {
								target = el;
								break;
							}
						}
						if (!target) {
							framesBeforePaint++;
							if (containsText(scopeRoot, loadingText)) loadingFrames++;
							requestAnimationFrame(frame);
							return;
						}
						paintAt = since();
						previous = editorSnapshot(target, readyText);
						if (previous.ready) set("lspReady", paintAt);
						if (previous.diagnostics > 0) set("diagnostics", paintAt);
						requestAnimationFrame(frame);
						return;
					}
					const current = editorSnapshot(target, readyText);
					const at = since();
					if (LAYOUT_KEYS.some((key) => current[key] !== previous[key])) {
						for (const key of LAYOUT_KEYS)
							if (
								current[key] !== previous[key] &&
								!(`layoutDelta_${key}` in ctx.marks)
							)
								set(
									`layoutDelta_${key}`,
									typeof current[key] === "number" &&
										typeof previous[key] === "number"
										? current[key] - previous[key]
										: 1,
								);
						late.layout++;
						set("layoutStable", at);
						lastVisual = at;
					}
					if (
						current.text === previous.text &&
						current.colors !== previous.colors
					) {
						late.colors++;
						set("colorsStable", at);
						lastVisual = at;
					}
					if (current.status !== previous.status) {
						late.status++;
						set("statusStable", at);
						lastVisual = at;
					}
					if (current.hints !== previous.hints) {
						late.hints++;
						lastVisual = at;
					}
					if (current.diagnostics !== previous.diagnostics) {
						late.diagnostics++;
						if (!("diagnostics" in ctx.marks) && current.diagnostics > 0)
							set("diagnostics", at);
					}
					if (current.ready && !("lspReady" in ctx.marks)) set("lspReady", at);
					previous = current;
					if (at - paintAt >= observeMs || !target.isConnected) {
						finish();
						return;
					}
					requestAnimationFrame(frame);
				};
				requestAnimationFrame(frame);
			});
		},

		shadowSelector(params, ctx) {
			return new Promise((resolve) => {
				const poll = () => {
					if (ctx.done) return;
					if (ctx.started) {
						const root = scope(params.within);
						const hosts = root ? root.querySelectorAll(params.host) : [];
						for (const host of hosts) {
							if (!isVisible(host)) continue;
							const shadow = host.shadowRoot;
							if (shadow?.querySelector(params.inner)) {
								ctx.mark("ready");
								const channel = new MessageChannel();
								channel.port1.onmessage = () => resolve(now());
								channel.port2.postMessage(null);
								return;
							}
						}
					}
					requestAnimationFrame(poll);
				};
				requestAnimationFrame(poll);
			});
		},

		terminalBytes(params, ctx) {
			return new Promise((resolve) => {
				const listener = (info) => {
					if (!ctx.started || ctx.done) return;
					const record = info.record;
					if (record.kind !== "terminal") return;
					if (record.createdAt < ctx.armedAt) return;
					if (params.create !== undefined && record.create !== params.create)
						return;
					if (params.workspaceId && record.workspaceId !== params.workspaceId)
						return;
					if (info.type === "socket-created") ctx.mark("socket-created");
					if (info.type === "json" && info.messageType === "attached")
						ctx.mark("attached");
					if (info.type === "json" && info.messageType === "synced")
						ctx.mark("synced");
					if (info.type !== "binary") return;
					if (record.syncedAt === null) return;
					ctx.mark("first-bytes");
					ctx.output = record.terminalId;
					frameListeners.delete(listener);
					afterPaint(2).then(resolve);
				};
				frameListeners.add(listener);
				ctx.cleanup.push(() => frameListeners.delete(listener));
			});
		},

		terminalEcho(params, ctx) {
			const expected = params.byte;
			let target = null;
			return new Promise((resolve) => {
				const listener = (info) => {
					if (!ctx.started || ctx.done) return;
					if (info.record.kind !== "terminal") return;
					if (info.type === "input-sent" && target === null) {
						target = info.record;
						ctx.mark("input-sent");
						return;
					}
					if (info.type !== "binary" || info.record !== target) return;
					if (!info.bytes || !info.bytes.includes(expected)) return;
					ctx.mark("echo-bytes");
					frameListeners.delete(listener);
					afterPaint(2).then(resolve);
				};
				frameListeners.add(listener);
				ctx.cleanup.push(() => frameListeners.delete(listener));
			});
		},

		workspaceTerminal(params, ctx) {
			const selector = `[data-workspace-id="${params.workspaceId}"]`;
			let socketSeen = false;
			let synced = false;
			let settled = false;
			let graceScheduled = false;
			return new Promise((resolve) => {
				const terminalVisible = () => {
					const root = document.querySelector(selector);
					if (!root || !isVisible(root)) return false;
					return [...root.querySelectorAll(".xterm")].some(isVisible);
				};
				const finish = () => {
					if (settled) return;
					settled = true;
					observer.disconnect();
					frameListeners.delete(listener);
					afterPaint(1).then(resolve);
				};
				const evaluate = () => {
					if (settled || !ctx.started || ctx.done) return;
					if (!terminalVisible()) return;
					ctx.mark("terminal-visible");
					if (socketSeen) {
						if (synced) finish();
						return;
					}
					if (graceScheduled) return;
					graceScheduled = true;
					requestAnimationFrame(() =>
						requestAnimationFrame(() => {
							if (socketSeen) {
								if (synced) finish();
								return;
							}
							ctx.mark("no-redial");
							finish();
						}),
					);
				};
				const observer = new MutationObserver(evaluate);
				observer.observe(document, {
					subtree: true,
					childList: true,
					attributes: true,
				});
				const listener = (info) => {
					if (!ctx.started || ctx.done || settled) return;
					const record = info.record;
					if (record.kind !== "terminal" || record.createdAt < ctx.armedAt)
						return;
					if (record.workspaceId !== params.workspaceId) return;
					if (info.type === "socket-created") {
						socketSeen = true;
						ctx.mark("socket-created");
					}
					if (info.type === "json" && info.messageType === "attached")
						ctx.mark("attached");
					if (info.type === "json" && info.messageType === "synced") {
						synced = true;
						ctx.mark("synced");
						evaluate();
					}
					if (info.type === "binary" && record.syncedAt !== null)
						ctx.mark("first-bytes");
				};
				frameListeners.add(listener);
				ctx.onStart(evaluate);
				ctx.cleanup.push(() => {
					observer.disconnect();
					frameListeners.delete(listener);
				});
			});
		},

		messagesStable(params, ctx) {
			let lastCount = -1;
			let lastPaint = null;
			let stableTimer = null;
			return new Promise((resolve) => {
				const evaluate = () => {
					if (!ctx.started || ctx.done) return;
					const root = scope(params.within);
					const count = root
						? root.querySelectorAll(params.selector).length
						: 0;
					const composer = root ? root.querySelector(params.composer) : null;
					const composerReady =
						!!composer && !composer.disabled && isVisible(composer);
					const key = composerReady ? count : -2;
					if (key === lastCount) return;
					lastCount = key;
					clearTimeout(stableTimer);
					if (count === 0 || !composerReady) return;
					ctx.mark("messages-changed");
					const paintPromise = afterPaint(1);
					lastPaint = paintPromise;
					stableTimer = setTimeout(() => {
						if (lastPaint !== paintPromise) return;
						ctx.output = String(count);
						observer.disconnect();
						paintPromise.then(resolve);
					}, params.stableMs);
				};
				const observer = new MutationObserver(evaluate);
				observer.observe(document, {
					subtree: true,
					childList: true,
					attributes: true,
				});
				ctx.onStart(evaluate);
				ctx.cleanup.push(() => {
					observer.disconnect();
					clearTimeout(stableTimer);
				});
			});
		},

		claudeReady(params, ctx) {
			let target = null;
			let buffer = "";
			let outputChars = 0;
			return new Promise((resolve) => {
				const listener = (info) => {
					if (!ctx.started || ctx.done) return;
					const record = info.record;
					if (record.kind !== "terminal") return;
					if (target === null) {
						if (params.watch === "input-socket") {
							if (info.type !== "input-sent") return;
							target = record;
							ctx.mark("input-sent");
							return;
						}
						if (record.createdAt < ctx.armedAt) return;
						target = record;
						ctx.mark("socket-created");
					}
					if (record !== target) return;
					if (info.type === "json" && info.messageType === "attached")
						ctx.mark("attached");
					if (info.type !== "binary" || !info.bytes) return;
					ctx.mark("first-bytes");
					buffer = (buffer + textDecoder.decode(info.bytes, { stream: true }))
						.replace(ANSI, "")
						.replace(/\s+/g, "")
						.slice(-6000);
					const matched = Object.keys(CLAUDE_MARKERS).filter((name) =>
						CLAUDE_MARKERS[name].test(buffer),
					);
					ctx.diag = [...new Set([...(ctx.diag ?? []), ...matched])];
					outputChars += info.bytes.length;
					if (outputChars > 1024) ctx.mark("output-1kb");
					if (CLAUDE_BLOCKED.test(buffer)) {
						buffer = "";
						frameListeners.delete(listener);
						ctx.fail("blocked-prompt");
						return;
					}
					if (CLAUDE_READY.test(buffer)) {
						buffer = "";
						ctx.output = record.terminalId;
						frameListeners.delete(listener);
						afterPaint(2).then(resolve);
					}
				};
				frameListeners.add(listener);
				ctx.cleanup.push(() => {
					buffer = "";
					frameListeners.delete(listener);
				});
			});
		},

		textareaChar(params, ctx) {
			return new Promise((resolve) => {
				const onInput = (event) => {
					if (!ctx.started || ctx.done) return;
					const element = event.target;
					if (!element || !element.matches || !element.matches(params.selector))
						return;
					if (!String(element.value ?? "").endsWith(params.char)) return;
					document.removeEventListener("input", onInput, true);
					ctx.mark("value-updated");
					afterPaint(1).then(resolve);
				};
				document.addEventListener("input", onInput, true);
				ctx.cleanup.push(() =>
					document.removeEventListener("input", onInput, true),
				);
			});
		},
	};

	const runs = new Map();
	let nextToken = 0;

	function arm(spec) {
		const token = ++nextToken;
		const ctx = {
			armedAt: now(),
			started: false,
			done: false,
			startTs: null,
			marks: {},
			output: null,
			cleanup: [],
			startHooks: [],
			mark(name) {
				if (this.startTs !== null && !(name in this.marks)) {
					this.marks[name] = now() - this.startTs;
				}
			},
			onStart(hook) {
				this.startHooks.push(hook);
			},
			fail: null,
		};
		const focusIndex = focusLog.length;
		const hadFocus = document.hasFocus();
		const promise = new Promise((resolve) => {
			const finish = (status, endTs, reason) => {
				if (ctx.done) return;
				ctx.done = true;
				clearTimeout(timer);
				for (const fn of ctx.cleanup) {
					try {
						fn();
					} catch {}
				}
				if (pendingStart.spec === spec.start) {
					pendingStart.spec = null;
					pendingStart.resolve = null;
				}
				const windowStart = ctx.startTs ?? ctx.armedAt;
				const windowEnd = endTs ?? now();
				let loafCount = 0;
				let loafBlockingMs = 0;
				for (const entry of loafEntries) {
					if (entry.end >= windowStart && entry.start <= windowEnd) {
						loafCount += 1;
						loafBlockingMs += entry.blocking;
					}
				}
				resolve({
					status,
					reason: reason ?? null,
					durationMs: status === "ok" ? endTs - ctx.startTs : null,
					marks: ctx.marks,
					output: ctx.output,
					focusLost:
						!hadFocus ||
						focusLog
							.slice(focusIndex)
							.some(([kind]) => kind !== "focus" && kind !== "visible"),
					loafCount,
					loafBlockingMs: Math.round(loafBlockingMs),
					diag: ctx.diag ?? null,
				});
			};
			ctx.fail = (reason) => finish("invalid", null, reason);
			const timer = setTimeout(
				() =>
					finish(
						ctx.started ? "timeout" : "invalid",
						null,
						ctx.started ? null : "no-start-event",
					),
				spec.timeoutMs ?? 15000,
			);
			if (Array.isArray(spec.jsonMarks) && spec.jsonMarks.length) {
				const markListener = (info) => {
					if (!ctx.started || ctx.done || info.type !== "json") return;
					if (spec.jsonMarks.includes(info.messageType))
						ctx.mark(info.messageType);
				};
				frameListeners.add(markListener);
				ctx.cleanup.push(() => frameListeners.delete(markListener));
			}
			const condition = endConditions[spec.end.kind];
			if (!condition) {
				finish("invalid", null, `unknown end ${spec.end.kind}`);
				return;
			}
			condition(spec.end, ctx).then((endTs) => finish("ok", endTs));
			pendingStart.spec = spec.start;
			pendingStart.resolve = (timeStamp) => {
				ctx.startTs = timeStamp;
				ctx.started = true;
				for (const hook of ctx.startHooks) {
					try {
						hook();
					} catch {}
				}
			};
		});
		runs.set(token, promise);
		return token;
	}

	function result(token) {
		const promise = runs.get(token);
		runs.delete(token);
		return (
			promise ?? Promise.resolve({ status: "invalid", reason: "unknown-token" })
		);
	}

	function waitQuiet(quietMs, timeoutMs) {
		return new Promise((resolve) => {
			const deadline = now() + timeoutMs;
			const tick = () => {
				const lastBinary = sockets.reduce(
					(latest, record) =>
						record.kind === "terminal" &&
						record.closedAt === undefined &&
						record.lastBinaryAt !== null
							? Math.max(latest, record.lastBinaryAt)
							: latest,
					-Infinity,
				);
				const quietFor = now() - lastBinary;
				if (quietFor >= quietMs || now() > deadline) {
					requestIdleCallback(() => resolve(quietFor >= quietMs), {
						timeout: 2000,
					});
					return;
				}
				setTimeout(tick, Math.max(16, quietMs - quietFor));
			};
			tick();
		});
	}

	function socketSummary() {
		return sockets.map((record) => ({
			kind: record.kind,
			create: record.create,
			open: record.openAt !== null && record.closedAt === undefined,
			binaryFrames: record.binaryFrames,
		}));
	}

	let echoText = null;
	const CONTROL = new RegExp(
		`[${String.fromCharCode(0)}-${String.fromCharCode(31)}]`,
		"g",
	);
	frameListeners.add((info) => {
		if (echoText === null) return;
		if (
			info.type !== "binary" ||
			!info.bytes ||
			info.record.kind !== "terminal"
		)
			return;
		echoText = (echoText + textDecoder.decode(info.bytes, { stream: true }))
			.replace(ANSI, "")
			.replace(CONTROL, "")
			.slice(-2000);
	});

	function startEcho() {
		echoText = "";
	}

	function echoIncludes(word) {
		const found = echoText?.includes(word) === true;
		if (found) echoText = null;
		return found;
	}

	function localHostPort() {
		for (let i = sockets.length - 1; i >= 0; i -= 1) {
			const record = sockets[i];
			if (
				record.local &&
				(record.kind === "terminal" || record.kind === "events")
			) {
				return record.port;
			}
		}
		return null;
	}

	function workspaceSocketInfo(workspaceId) {
		const records = sockets.filter(
			(r) => r.kind === "terminal" && r.workspaceId === workspaceId,
		);
		return {
			terminals: records.filter((r) => r.closedAt === undefined).length,
			local: records.length > 0 && records.every((r) => r.local),
		};
	}

	function terminalIdsForWorkspace(workspaceId) {
		return sockets
			.filter(
				(r) =>
					r.kind === "terminal" &&
					r.workspaceId === workspaceId &&
					r.closedAt === undefined,
			)
			.map((r) => r.terminalId);
	}

	window.__perfProbe = {
		version: 1,
		arm,
		result,
		waitQuiet,
		socketSummary,
		terminalIdsForWorkspace,
		localHostPort,
		startEcho,
		echoIncludes,
		workspaceSocketInfo,
		frameIntervalMs: () =>
			new Promise((resolve) => {
				const stamps = [];
				const step = (t) => {
					stamps.push(t);
					if (stamps.length < 31) requestAnimationFrame(step);
					else {
						const deltas = stamps
							.slice(1)
							.map((v, i) => v - stamps[i])
							.sort((a, b) => a - b);
						resolve(deltas[Math.floor(deltas.length / 2)]);
					}
				};
				requestAnimationFrame(step);
			}),
	};
})();
