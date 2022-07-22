import { getScheduledTweets } from "../routes/schedule";
import { getConfig } from "../routes/updateConfig";
import { get, set } from "./redis.server";
import type {
	config,
	frequencyType,
	scheduledTweet,
	serverConfig,
} from "./types";

const PERIODS = {
	second: 1000,
	minute: 1000 * 60,
	hour: 1000 * 60 * 60,
};

export class PeriodManager {
	currentPeriodStart = 0;
	currentPeriodEnd = 0;
	type: frequencyType = "hour";

	PERIOD_MAP = {
		hour: 3600000,
		day: 86400000,
		week: 604800000,
	};

	OPTIONS_MAP = {
		// these are only the maximum values
		hour: 60,
		day: 24,
		week: 7,
	};

	constructor(type: frequencyType) {
		this.type = type;
		const now = new Date().getTime();
		this.currentPeriodStart = now - (now % this.PERIOD_MAP[type]);
		this.currentPeriodEnd = this.currentPeriodStart + this.PERIOD_MAP[type];
	}

	nextPeriod() {
		this.currentPeriodStart = this.currentPeriodEnd;
		this.currentPeriodEnd =
			this.currentPeriodStart + this.PERIOD_MAP[this.type];
	}

	includes(date: number) {
		return date >= this.currentPeriodStart && date < this.currentPeriodEnd;
	}

	findOptions() {
		const amount = this.OPTIONS_MAP[this.type];
		const multiplier = this.PERIOD_MAP[this.type] / this.OPTIONS_MAP[this.type];
		const options = [];
		for (let i = 0; i < amount; i++) {
			const timestamp = this.currentPeriodStart + i * multiplier;
			if (timestamp < this.currentPeriodEnd) options.push(timestamp);
			else return options;
		}
		return options;
	}
}

export async function scheduleTweet(
	tweet: scheduledTweet,
	userId: string
): Promise<scheduledTweet> {
	const allTweets: scheduledTweet[] = await getScheduledTweets(userId);
	const userConfig = await getConfig(userId);
	const scheduledDate = _scheduleSingle(tweet, allTweets, userConfig);
	const newTweet = { ...tweet, scheduledDate };
	set(`scheduled_tweet=${userId},${tweet.id}`, newTweet);
	return newTweet;
}

function _determineTime(
	tweet: scheduledTweet,
	period: PeriodManager,
	config: serverConfig
): number {
	// Timezone adjusting (yeah, there's timezones with shifts in minutes, I wish i was joking)

	const TZ_ADJUSTMENTS = {
		hour: Math.floor(config.time.tz / 60),
		minute: config.time.tz % 60,
	};

	switch (period.type) {
		case "hour": {
			if (config.time.type === "specific") {
				return (
					period.currentPeriodStart +
					(config.time.computedValue[0].minute + TZ_ADJUSTMENTS.minute) *
						PERIODS.minute
				);
			} else if (config.time.type === "range") {
				const availableOptions = period.findOptions();
				const matchedOptions = [];
				const [min, max] = config.time.computedValue
					.map((value) => ({
						hour: value.hour + TZ_ADJUSTMENTS.hour,
						minute: value.minute + TZ_ADJUSTMENTS.minute,
					}))
					.sort((a, b) => a.minute - b.minute);
				for (let i = 0; i < availableOptions.length; i++) {
					if (i >= min.minute) {
						if (i > max.minute) break;
						else matchedOptions.push(availableOptions[i]);
					}
				}
				return matchedOptions[
					Math.floor(tweet.random_offset * matchedOptions.length)
				];
			}
		}

		case "day": {
			if (config.time.type === "specific") {
				return (
					period.currentPeriodStart +
					(config.time.computedValue[0].hour + TZ_ADJUSTMENTS.hour) *
						PERIODS.hour +
					(config.time.computedValue[0].minute + TZ_ADJUSTMENTS.minute) *
						PERIODS.minute
				);
				// can't use the normal date api here for timezone reasons
			} else if (config.time.type === "range") {
				const [min, max] = config.time.computedValue.map((value) => ({
					hour: value.hour + TZ_ADJUSTMENTS.hour,
					minute: value.minute + TZ_ADJUSTMENTS.minute,
				}));
				const rangeStart =
					period.currentPeriodStart +
					min.minute * PERIODS.minute +
					min.hour * PERIODS.hour;
				const rangeEnd =
					period.currentPeriodStart +
					max.minute * PERIODS.minute +
					max.hour * PERIODS.hour;

				return rangeStart + tweet.random_offset * (rangeEnd - rangeStart);
			}
		}

		case "week": {
			const days = period.findOptions();
			const day = days[Math.floor(tweet.random_offset * days.length)];
			if (config.time.type === "specific") {
				return (
					day +
					(config.time.computedValue[0].hour + TZ_ADJUSTMENTS.hour) *
						PERIODS.hour +
					(config.time.computedValue[0].minute + TZ_ADJUSTMENTS.minute) *
						PERIODS.minute
				);
			} else if (config.time.type === "range") {
				const [min, max] = config.time.computedValue.map((value) => ({
					hour: value.hour + TZ_ADJUSTMENTS.hour,
					minute: value.minute + TZ_ADJUSTMENTS.minute,
				}));
				const rangeStart =
					day + min.minute * PERIODS.minute + min.hour * PERIODS.hour;
				const rangeEnd =
					day + max.minute * PERIODS.minute + max.hour * PERIODS.hour;

				return rangeStart + tweet.random_offset * (rangeEnd - rangeStart);
			}
		}

		default: {
			return 0;
		}
	}
}

function _scheduleSingle(
	tweet: scheduledTweet,
	allTweets: scheduledTweet[],
	userConfig: serverConfig
): number | null {
	// this is quite inefficient
	// there should be a way to do this in O(1)

	// When the config value is 0, the loop would run an infinite number of times. This line prevents that:
	if (userConfig.frequency.value === 0) return null;

	const period = new PeriodManager(userConfig.frequency.type);
	// but right now, we're iterating over the whole list for every period, until we find one that doesn't have enouth already

	while (
		allTweets.filter((tweet) =>
			tweet.scheduledDate ? period.includes(tweet.scheduledDate) : false
		).length >= userConfig.frequency.value
	)
		period.nextPeriod();

	// computing the sending date
	return _determineTime(tweet, period, userConfig) || null;
}

export async function checkFulfillment(
	userId: string,
	next = false
): Promise<{
	fulfilled: boolean;
	periodType: frequencyType;
	periodStart: number;
	expectation: number;
	reality: number;
}> {
	const userConfig = await getConfig(userId);
	const scheduledTweets = await getScheduledTweets(userId);

	const period = new PeriodManager(userConfig.frequency.type);

	if (next) period.nextPeriod();

	const tweetsInPeriod = scheduledTweets.filter((tweet) =>
		tweet.scheduledDate ? period.includes(tweet.scheduledDate) : false
	).length;
	return {
		fulfilled: tweetsInPeriod >= userConfig.frequency.value,
		periodType: userConfig.frequency.type,
		periodStart: period.currentPeriodStart,
		expectation: userConfig.frequency.value,
		reality: tweetsInPeriod,
	};
}

export async function rescheduleAll(
	userId: string,
	config?: serverConfig,
	inputTweets?: scheduledTweet[]
): Promise<scheduledTweet[]> {
	const allTweets: scheduledTweet[] = inputTweets
		? inputTweets
		: await getScheduledTweets(userId);

	if (!allTweets.length) return [];

	const userConfig = config ? config : await getConfig(userId);

	if (userConfig.frequency.value === 0) {
		const newTweets = allTweets.map((tweet) => ({
			...tweet,
			scheduledDate: null,
		}));
		newTweets.forEach((tweet) =>
			set(`scheduled_tweet=${userId},${tweet.id}`, tweet)
		);

		return newTweets;
	} else {
		const newTweets: scheduledTweet[] = [];
		const period = new PeriodManager(userConfig.frequency.type);
		const sentTweets: scheduledTweet[] = allTweets.filter(
			(tweet) =>
				tweet.sent && (tweet.scheduledDate || 0) < period.currentPeriodStart
		);
		const unsentTweets: scheduledTweet[] = allTweets.filter(
			(tweet) => !tweet.sent
		);

		let currentAmount = sentTweets.filter((tweet) =>
			tweet.scheduledDate ? period.includes(tweet.scheduledDate) : false
		).length;
		const checkPeriodFulfillment = () => {
			if (currentAmount === userConfig.frequency.value) {
				period.nextPeriod();
				currentAmount = sentTweets.filter((tweet) =>
					tweet.scheduledDate ? period.includes(tweet.scheduledDate) : false
				).length;
				checkPeriodFulfillment();
			}
		};
		while (unsentTweets.length > newTweets.length) {
			const target = unsentTweets[newTweets.length];
			const newTweet = {
				...target,
				scheduledDate: _determineTime(target, period, userConfig),
			};
			newTweets.push(newTweet);
			set(`scheduled_tweet=${userId},${target.id}`, newTweet);

			currentAmount++;
			checkPeriodFulfillment();
		}
		return newTweets;
	}
}
