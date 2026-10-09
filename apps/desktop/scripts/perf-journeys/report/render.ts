import type { DistributionSummary } from "../lib/stats";
import type { JourneySummary, RunSummary } from "../lib/summary";

interface CardSpec {
	journey: string;
	variant: string;
	title: string;
	subtitle: string;
}

interface Section {
	label: string;
	note?: string;
	cards: CardSpec[];
}

const LAUNCH_CARDS: Array<{ marker: string; title: string }> = [
	{ marker: "window-show", title: "Janela visível" },
	{ marker: "shell-interactive", title: "Shell interativo" },
	{ marker: "terminal-usable", title: "Terminal utilizável" },
];

const SECTIONS: Section[] = [
	{
		label: "Iniciando uma sessão",
		cards: [
			{
				journey: "new-terminal",
				variant: "warm",
				title: "Novo terminal",
				subtitle: "⌘J · primeiro output",
			},
			{
				journey: "codex-chat-composer",
				variant: "warm",
				title: "Novo Codex Chat",
				subtitle: "⌘T · composer pronto",
			},
			{
				journey: "codex-chat-composer",
				variant: "cold-catalog",
				title: "Novo Codex Chat",
				subtitle: "catálogo de modelos frio",
			},
			{
				journey: "claude-session",
				variant: "shell",
				title: "Claude Code",
				subtitle: "claude no terminal · CLI pronto",
			},
			{
				journey: "create-workspace",
				variant: "worktree-no-setup",
				title: "Criar workspace",
				subtitle: "worktree · sem setup",
			},
		],
	},
	{
		label: "Carregando",
		cards: [
			{
				journey: "switch-workspace",
				variant: "revisit",
				title: "Trocar de workspace",
				subtitle: "pela paleta · revisita",
			},
			{
				journey: "switch-workspace",
				variant: "first-visit",
				title: "Trocar de workspace",
				subtitle: "pela paleta · primeira visita",
			},
			{
				journey: "load-conversation",
				variant: "first-visit",
				title: "Conversa Codex",
				subtitle: "pela paleta · primeira visita",
			},
			{
				journey: "load-conversation",
				variant: "revisit",
				title: "Conversa Codex",
				subtitle: "pela paleta · revisita",
			},
			{
				journey: "quick-open-palette",
				variant: "open",
				title: "Paleta de arquivos",
				subtitle: "⌘P · paleta aberta",
			},
			{
				journey: "quick-open-file",
				variant: "code-editor",
				title: "Abrir arquivo",
				subtitle: "clique no resultado · editor pintado",
			},
			{
				journey: "changes-panel",
				variant: "cold",
				title: "Painel de alterações",
				subtitle: "frio · após reload",
			},
			{
				journey: "changes-panel",
				variant: "warm",
				title: "Painel de alterações",
				subtitle: "quente",
			},
		],
	},
	{
		label: "Digitando",
		note: "fatia client-side",
		cards: [
			{
				journey: "keystroke-echo",
				variant: "terminal",
				title: "Tecla → eco",
				subtitle: "terminal · shell",
			},
			{
				journey: "codex-composer-keystroke",
				variant: "textarea",
				title: "Tecla → composer",
				subtitle: "Codex Chat",
			},
		],
	},
];

const MARKER_LABELS: Record<string, string> = {
	"bootstrap-imports-end": "Imports do main",
	"app-ready": "app.whenReady",
	"window-created": "Janela criada",
	"window-show": "Janela visível",
	"react-commit": "Primeiro commit React",
	"shell-interactive": "Shell interativo",
	"terminal-usable": "Terminal utilizável",
};

const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("pt-BR", {
	minimumFractionDigits: 1,
	maximumFractionDigits: 1,
});

function escapeHtml(value: unknown): string {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function formatMs(value: number | null): string {
	if (value === null || !Number.isFinite(value)) return "—";
	if (value >= 10_000) return `${oneDecimal.format(value / 1000)} s`;
	if (value >= 100) return `${integer.format(value)} ms`;
	return `${oneDecimal.format(value)} ms`;
}

function splitValue(value: number | null): { number: string; unit: string } {
	const text = formatMs(value);
	const [number, unit] = text.split(" ");
	return { number: number ?? "—", unit: unit ?? "" };
}

function bar(distribution: DistributionSummary): string {
	const { p50, p75, p95 } = distribution;
	if (p50 === null || p75 === null || p95 === null || p95 <= 0) {
		return `<div class="bar" aria-hidden="true"><span class="track"></span></div>`;
	}
	const fill = Math.min(100, (p75 / p95) * 100);
	const tick = Math.min(100, (p50 / p95) * 100);
	return `<div class="bar" role="img" aria-label="p50 ${escapeHtml(formatMs(p50))}, p75 ${escapeHtml(formatMs(p75))}, p95 ${escapeHtml(formatMs(p95))}">
		<span class="track"></span>
		<span class="fill" style="width:${fill.toFixed(2)}%"></span>
		<span class="tick" style="left:${tick.toFixed(2)}%"></span>
	</div>`;
}

function card(
	title: string,
	subtitle: string,
	distribution: DistributionSummary,
	extra: { timeouts?: number; attempts?: number; missing?: number } = {},
): string {
	const headline = splitValue(distribution.p75);
	const p95Label = distribution.p95IsMax ? "máx" : "p95";
	const flags: string[] = [];
	if (extra.timeouts)
		flags.push(`${extra.timeouts} timeout${extra.timeouts > 1 ? "s" : ""}`);
	if (extra.missing) flags.push(`${extra.missing} sem marcador`);
	return `<article class="card">
		<header>
			<h3>${escapeHtml(title)}</h3>
			<p class="sub">${escapeHtml(subtitle)}</p>
		</header>
		<p class="headline"><span class="value">${escapeHtml(headline.number)}</span><span class="unit">${escapeHtml(headline.unit)}</span><span class="pct">p75</span></p>
		${bar(distribution)}
		<p class="range">p50 <strong>${escapeHtml(formatMs(distribution.p50))}</strong> · ${p95Label} <strong>${escapeHtml(formatMs(distribution.p95))}</strong></p>
		<p class="meta">n = ${distribution.n}${flags.length ? ` · ${escapeHtml(flags.join(" · "))}` : ""}</p>
	</article>`;
}

function emptyCard(title: string, subtitle: string, reason: string): string {
	return `<article class="card muted">
		<header>
			<h3>${escapeHtml(title)}</h3>
			<p class="sub">${escapeHtml(subtitle)}</p>
		</header>
		<p class="na">${escapeHtml(reason)}</p>
	</article>`;
}

function findJourney(
	journeys: JourneySummary[],
	spec: CardSpec,
): JourneySummary | undefined {
	return journeys.find(
		(j) => j.journey === spec.journey && j.variant === spec.variant,
	);
}

function launchSection(summary: RunSummary): string {
	const launch = summary.launch;
	if (!launch) return "";
	const useSpawn = launch.preNode.n > 0;
	const cards = LAUNCH_CARDS.map(({ marker, title }) => {
		const entry = launch.markers.find((m) => m.marker === marker);
		if (!entry) return emptyCard(title, "", "sem dados");
		const distribution = useSpawn ? entry.spawnOrigin : entry.nodeOrigin;
		return card(
			title,
			useSpawn
				? "abertura a frio do processo · desde o open"
				: "desde o início do Node",
			distribution,
			{ missing: entry.missing },
		);
	}).join("");
	return `<section>
		<h2>Abrindo o app</h2>
		<div class="grid">${cards}</div>
	</section>`;
}

function launchTable(summary: RunSummary): string {
	const launch = summary.launch;
	if (!launch) return "";
	const rows = launch.markers
		.filter((m) => m.marker in MARKER_LABELS)
		.map(
			(m) => `<tr>
				<th scope="row">${escapeHtml(MARKER_LABELS[m.marker])}</th>
				<td>${escapeHtml(formatMs(m.nodeOrigin.p50))}</td>
				<td>${escapeHtml(formatMs(m.nodeOrigin.p75))}</td>
				<td>${escapeHtml(formatMs(m.nodeOrigin.p95))}</td>
				<td>${m.nodeOrigin.n}</td>
			</tr>`,
		)
		.join("");
	const perturbation = launch.perturbation;
	const perturbationNote =
		perturbation?.deltaPct !== null && perturbation?.deltaPct !== undefined
			? `<p class="footnote">Com o inspector do main ligado, o p50 do shell interativo ficou ${escapeHtml(oneDecimal.format(perturbation.deltaPct))}% ${perturbation.deltaPct >= 0 ? "acima" : "abaixo"} das aberturas sem inspector (${escapeHtml(formatMs(perturbation.withInspectP50))} vs ${escapeHtml(formatMs(perturbation.withoutInspectP50))}).</p>`
			: "";
	return `<section class="detail">
		<h2>Abertura em detalhe <span class="note">desde o início do Node · marcadores P00</span></h2>
		<div class="table-wrap">
			<table>
				<thead><tr><th scope="col">Marco</th><th scope="col">p50</th><th scope="col">p75</th><th scope="col">p95</th><th scope="col">n</th></tr></thead>
				<tbody>${rows}</tbody>
			</table>
		</div>
		<p class="footnote">Antes do Node (LaunchServices + init nativo do Electron), p50: <strong>${escapeHtml(formatMs(launch.preNode.p50))}</strong>. ${launch.accepted} de ${launch.launches} aberturas aceitas (janela em primeiro plano, tela desbloqueada, primeira descartada).</p>
		${perturbationNote}
	</section>`;
}

function caveats(run: Record<string, unknown>, summary: RunSummary): string {
	const notes: string[] = [];
	if (run.acPowerAtStart === false || run.acPowerAtEnd === false) {
		notes.push("Medido na bateria, com o modo de pouca energia desligado.");
	}
	if (summary.launch && summary.launch.frontmostConfirmed === 0) {
		notes.push(
			"A checagem de janela em primeiro plano não funcionou nesta execução; as aberturas usaram open -a, que ativa o app, e a tela estava desbloqueada em todas.",
		);
	}
	if (summary.journeys.some((j) => j.journey === "switch-workspace")) {
		notes.push(
			"Na troca de workspace o fim é o workspace com o terminal visível; quando o socket do terminal reconecta depois disso, a reconexão não entra no número.",
		);
	}
	if (typeof run.frameIntervalMs === "number") {
		notes.push(
			`Tela a ${integer.format(1000 / run.frameIntervalMs)} Hz: cada frame dura cerca de ${oneDecimal.format(run.frameIntervalMs)} ms.`,
		);
	}
	if (notes.length === 0) return "";
	return `<p><strong>Ressalvas desta execução.</strong> ${notes.map(escapeHtml).join(" ")}</p>`;
}

export function renderReport(input: {
	run: Record<string, unknown>;
	summary: RunSummary;
}): string {
	const { run, summary } = input;
	const measured = summary.journeys.reduce((t, j) => t + j.distribution.n, 0);
	const launchSamples =
		summary.launch?.markers.find((m) => m.marker === "terminal-usable")
			?.spawnOrigin.n ?? 0;
	const sections = SECTIONS.map((section) => {
		const cards = section.cards
			.map((spec) => {
				const journey = findJourney(summary.journeys, spec);
				if (!journey || journey.distribution.n === 0) {
					return emptyCard(
						spec.title,
						spec.subtitle,
						"não disponível nesta execução",
					);
				}
				return card(spec.title, spec.subtitle, journey.distribution, {
					timeouts: journey.timeouts,
					attempts: journey.attempts,
				});
			})
			.join("");
		const extra =
			section.label === "Digitando"
				? emptyCard(
						"Enviar mensagem ao modelo",
						"Codex / Claude",
						"não medido: exige uma chamada real ao modelo",
					)
				: "";
		return `<section>
			<h2>${escapeHtml(section.label)}${section.note ? ` <span class="note">${escapeHtml(section.note)}</span>` : ""}</h2>
			<div class="grid">${cards}${extra}</div>
		</section>`;
	}).join("");
	const journeyCount =
		new Set(summary.journeys.map((j) => j.journey)).size +
		(summary.launch ? 1 : 0);
	const head = String(run.gitHead ?? "").slice(0, 9);
	return `<title>Latência das jornadas Superset</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap">
<style>
/* Layout: one column of journey sections, each a wrapping grid of equal cards, like a RUM summary sheet. */
:root {
	--bg: #151514;
	--card: #151514;
	--line: #3b3a37;
	--fg: #f1f0eb;
	--muted: #9b9993;
	--track: #74726c;
	--accent: #d9785b;
	--font-text: "Instrument Sans", "Helvetica Neue", Arial, sans-serif;
	--font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
	color-scheme: dark;
}
@media (prefers-color-scheme: light) {
	:root:not([data-theme="dark"]) {
		--bg: #f5f5f2; --card: #ffffff; --line: #d8d7d1; --fg: #1b1b19;
		--muted: #6b6a64; --track: #b9b7b0; --accent: #c2583a; color-scheme: light;
	}
}
:root[data-theme="light"] {
	--bg: #f5f5f2; --card: #ffffff; --line: #d8d7d1; --fg: #1b1b19;
	--muted: #6b6a64; --track: #b9b7b0; --accent: #c2583a; color-scheme: light;
}
body { background: var(--bg); color: var(--fg); font-family: var(--font-text); font-size: 15px; line-height: 1.45; }
.page { max-width: 1120px; margin: 0 auto; padding-inline: 16px; padding-block: 28px 40px; display: flex; flex-direction: column; gap: 32px; }
.top { display: flex; flex-direction: column; gap: 6px; }
.top h1 { margin: 0; font-size: clamp(24px, 4vw, 32px); font-weight: 500; letter-spacing: -0.01em; text-wrap: balance; }
.top p { margin: 0; color: var(--muted); font-size: 16px; }
section { display: flex; flex-direction: column; gap: 14px; }
h2 { margin: 0; font-family: var(--font-mono); font-weight: 500; font-size: 15px; text-transform: uppercase; letter-spacing: 0.12em; }
h2 .note { font-family: var(--font-text); text-transform: none; letter-spacing: 0; color: var(--muted); font-size: 15px; margin-left: 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; }
.card { background: var(--card); border: 1.5px solid var(--line); padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.card header { display: flex; flex-direction: column; gap: 2px; }
.card h3 { margin: 0; font-size: 21px; font-weight: 500; letter-spacing: -0.005em; }
.card .sub { margin: 0; color: var(--muted); font-size: 15px; }
.headline { margin: 8px 0 0; display: flex; align-items: baseline; gap: 6px; font-variant-numeric: tabular-nums; }
.headline .value { font-size: 44px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; }
.headline .unit { font-size: 20px; color: var(--muted); }
.headline .pct { margin-left: auto; font-family: var(--font-mono); font-size: 13px; color: var(--muted); }
.bar { position: relative; height: 14px; }
.bar .track { position: absolute; left: 0; right: 0; top: 0; height: 5px; background: var(--track); }
.bar .fill { position: absolute; left: 0; top: 8px; height: 6px; background: var(--accent); }
.bar .tick { position: absolute; top: -2px; width: 2px; height: 18px; background: var(--fg); transform: translateX(-1px); }
.range { margin: 0; color: var(--muted); font-variant-numeric: tabular-nums; }
.range strong { color: var(--fg); font-weight: 500; }
.meta { margin: 0; color: var(--muted); font-family: var(--font-mono); font-size: 12px; }
.card.muted { border-style: dashed; }
.na { margin: auto 0 0; color: var(--muted); }
.detail table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
.table-wrap { overflow-x: auto; }
.detail th, .detail td { text-align: right; padding: 8px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.detail th[scope="row"], .detail thead th:first-child { text-align: left; font-weight: 400; }
.detail thead th { font-family: var(--font-mono); font-size: 12px; font-weight: 500; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
.footnote { margin: 0; color: var(--muted); max-width: 70ch; }
.footnote strong { color: var(--fg); font-weight: 500; }
footer { border-top: 1px solid var(--line); padding-top: 16px; color: var(--muted); display: flex; flex-direction: column; gap: 8px; }
footer p { margin: 0; max-width: 80ch; }
@media (max-width: 480px) { .headline .value { font-size: 38px; } }
</style>
<main class="page">
	<div class="top">
		<h1>Jornadas principais do Superset, p75</h1>
		<p>App desktop ${escapeHtml(run.appVersion ?? "")} · commit ${escapeHtml(head)} · perfil real logado · ${escapeHtml(run.cpuBrand ?? run.hardware ?? "")}${run.memoryGiB ? ` · ${escapeHtml(run.memoryGiB)} GB` : ""} · macOS ${escapeHtml(run.macos ?? "")}</p>
	</div>
	${launchSection(summary)}
	${sections}
	${launchTable(summary)}
	<footer>
		<p>${integer.format(measured + launchSamples)} medições em ${journeyCount} jornadas. O número grande é o p75; a barra vai de 0 ao p95, o trecho colorido até o p75 e o traço marca o p50. Percentis por posto mais próximo; amostras de aquecimento descartadas.</p>
		<p>Interações: do <code>timeStamp</code> do input real (CDP) até o frame pintado com o resultado, no relógio do renderer. Terminal e Claude detectados pelos bytes do WebSocket; a prontidão do Claude Code é heurística (caixa de prompt do CLI). Trocar de workspace e abrir conversa partem da lista de workspaces da paleta (⌘⇧K). Criar workspace usa worktree real sem o script de setup. Update automático desligado durante a medição.</p>
		${caveats(run, summary)}
	</footer>
</main>`;
}
