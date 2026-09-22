import type { GraphRow } from "../../utils/buildGraph";

const colors = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
];
const x = (lane: number) => 12 + lane * 14;

export function CommitGraph({ row, width }: { row: GraphRow; width: number }) {
	return (
		<svg
			aria-hidden="true"
			width={width}
			height={40}
			className="shrink-0 overflow-visible"
		>
			{row.edges.map((edge, index) => (
				<path
					key={`${edge.from}-${edge.to}-${index}`}
					d={
						edge.incoming
							? `M ${x(edge.from)} 0 V ${edge.outgoing ? 40 : 20}`
							: `M ${x(edge.from)} 20 C ${x(edge.from)} 30 ${x(edge.to)} 30 ${x(edge.to)} ${edge.missing ? 34 : 40}`
					}
					fill="none"
					stroke={colors[edge.to % colors.length]}
					strokeWidth={1.5}
					strokeDasharray={edge.missing ? "2 3" : undefined}
					opacity={edge.missing ? 0.45 : 0.8}
				/>
			))}
			<circle
				cx={x(row.lane)}
				cy={20}
				r={4}
				fill={colors[row.lane % colors.length]}
				stroke="var(--background)"
				strokeWidth={1.5}
			/>
		</svg>
	);
}
