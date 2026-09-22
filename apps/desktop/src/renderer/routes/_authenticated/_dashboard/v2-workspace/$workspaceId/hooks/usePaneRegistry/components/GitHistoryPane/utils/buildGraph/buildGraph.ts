export interface GraphRow {
	lane: number;
	width: number;
	edges: {
		from: number;
		to: number;
		incoming: boolean;
		outgoing: boolean;
		missing?: boolean;
	}[];
}

export function buildGraph(
	commits: { hash: string; parents: string[] }[],
): GraphRow[] {
	const visible = new Set(commits.map((commit) => commit.hash));
	const lanes: (string | null)[] = [];
	return commits.map((commit) => {
		let lane = lanes.indexOf(commit.hash);
		if (lane < 0) {
			lane = lanes.indexOf(null);
			if (lane < 0) lane = lanes.length;
		}
		const edges: GraphRow["edges"] = lanes.flatMap((target, index) =>
			target
				? [
						{
							from: index,
							to: index,
							incoming: true,
							outgoing: target !== commit.hash,
						},
					]
				: [],
		);
		lanes[lane] = null;
		for (const parent of commit.parents) {
			if (!visible.has(parent)) {
				edges.push({
					from: lane,
					to: lane,
					incoming: false,
					outgoing: true,
					missing: true,
				});
				continue;
			}
			let target = lanes.indexOf(parent);
			if (target < 0) {
				target = lanes[lane] === null ? lane : lanes.indexOf(null);
				if (target < 0) target = lanes.length;
				lanes[target] = parent;
			}
			edges.push({ from: lane, to: target, incoming: false, outgoing: true });
		}
		const width = Math.max(lanes.length, lane + 1);
		while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
		return { lane, width, edges };
	});
}
