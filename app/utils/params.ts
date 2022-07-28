const buildSearchParams = (
	params: { [key: string]: any },
	withInitial = true
) => {
	if (!params) return "";
	return (
		(withInitial ? "?" : "") +
		Object.keys(params)
			.filter((key) => params[key] !== undefined)
			.map((key) => `${key}=${encodeURIComponent(params[key])}`)
			.join("&")
	);
};

export default buildSearchParams;
