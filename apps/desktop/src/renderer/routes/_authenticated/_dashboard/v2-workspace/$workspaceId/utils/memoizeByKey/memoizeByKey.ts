export function memoizeByKey<T>(
	limit: number,
): (key: string, create: () => T) => T {
	const entries = new Map<string, T>();
	return (key, create) => {
		if (entries.has(key)) {
			const cached = entries.get(key) as T;
			entries.delete(key);
			entries.set(key, cached);
			return cached;
		}
		const value = create();
		entries.set(key, value);
		if (entries.size > limit) {
			const oldest = entries.keys().next().value;
			if (oldest !== undefined) entries.delete(oldest);
		}
		return value;
	};
}
