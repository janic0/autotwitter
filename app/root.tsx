import type { MetaFunction } from "@remix-run/node";
import styles from "./styles/global.css";
import common from "./styles/common.css";
import {
	Links,
	LiveReload,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
} from "@remix-run/react";

export const meta: MetaFunction = () => ({
	charset: "utf-8",
	title: "TweetSchedule",
	viewport: "width=device-width,initial-scale=1",
});

// styles is now something like /build/global-AE33KB2.css

export function links() {
	return [
		{ rel: "stylesheet", href: styles },
		{ rel: "stylesheet", href: common },
	];
}

export default function App() {
	return (
		<html lang="en">
			<head>
				<Meta />
				<Links />
			</head>
			<body>
				<Outlet />
				<ScrollRestoration />
				<Scripts />
				<LiveReload />
			</body>
		</html>
	);
}
