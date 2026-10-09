export function launchSchedule(inspected: number, plain: number): boolean[] {
	const schedule: boolean[] = Array.from({ length: inspected }, () => true);
	for (let k = 0; k < plain; k++) {
		const position = Math.round(((k + 1) * (inspected + plain)) / (plain + 1));
		schedule.splice(Math.max(1, position), 0, false);
	}
	return schedule;
}
